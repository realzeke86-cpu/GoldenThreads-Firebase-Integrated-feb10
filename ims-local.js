// ==========================================
// FIRESTORE DATABASE CONFIGURATION
// ==========================================
// This version uses Firebase Firestore for cloud-based data storage
// with offline persistence support

// FIRESTORE COLLECTIONS
const FIRESTORE_COLLECTIONS = {
    users: 'users',
    orders: 'orders',
    jobOrders: 'jobOrders',
    productions: 'productions',
    billings: 'billings',
    deliveries: 'deliveries',
    employees: 'employees',
    payrolls: 'payrolls',
    inventory: 'inventory',
    config: 'config'
};

// Declare Firebase service references (will be initialized in firebase-config.js and updated in DOMContentLoaded)
let auth, db, storage;

// Initialize Firestore and load data
async function initializeFirestore() {
    try {
        // Wait for auth to be ready
        await new Promise((resolve) => {
            const unsubscribe = auth.onAuthStateChanged(() => {
                unsubscribe();
                resolve();
            });
        });

        // Load data from Firestore
        await loadAllDataFromFirestore();
        console.log('✓ Firestore initialized and data loaded successfully');
    } catch (error) {
        console.error('Error initializing Firestore:', error);
        // Fall back to empty state if Firestore fails
        AppState.orders = [];
        AppState.jobOrders = [];
        AppState.productions = [];
        AppState.billings = [];
        AppState.deliveries = [];
        AppState.employees = [];
        AppState.payrolls = [];
        AppState.inventoryManagementItems = [];
        AppState.inventoryCatalogItems = [];
    }
}

// Load all data from Firestore
async function loadAllDataFromFirestore() {
    try {
        if (!AppState.currentUser?.uid) return;

        // Load all collections (globally shared)
        AppState.orders = await loadCollectionByOrg(FIRESTORE_COLLECTIONS.orders);
        AppState.jobOrders = await loadCollectionByOrg(FIRESTORE_COLLECTIONS.jobOrders);
        AppState.productions = await loadCollectionByOrg(FIRESTORE_COLLECTIONS.productions);
        AppState.billings = await loadCollectionByOrg(FIRESTORE_COLLECTIONS.billings);
        AppState.deliveries = await loadCollectionByOrg(FIRESTORE_COLLECTIONS.deliveries);
        AppState.employees = await loadCollectionByOrg(FIRESTORE_COLLECTIONS.employees);
        AppState.payrolls = await loadCollectionByOrg(FIRESTORE_COLLECTIONS.payrolls);
        AppState.inventoryManagementItems = await loadCollectionByOrg('inventory_management');
        AppState.inventoryCatalogItems = await loadCollectionByOrg('inventory_catalog');
        AppState.inventoryDeductionHistory = await loadCollectionByOrg('inventory_deduction_history');
        AppState.employeeAttendance = await loadCollectionByOrg('employee_attendance') || [];

        // Calculate orderCounter
        if (AppState.orders.length > 0) {
            const maxCounter = Math.max(...AppState.orders.map(order => {
                const match = order.orderId.match(/ORD\s*-\s*\d+\s*-\s*(\d+)/);
                return match ? parseInt(match[1]) : 0;
            }));
            AppState.orderCounter = maxCounter + 1;
        }

        console.log('✓ All data loaded from Firestore');
        // Ensure UI badges/tables reflect freshly loaded data
        try {
            if (typeof updateBillingBadges === 'function') updateBillingBadges();
            if (AppState.currentPage === 'billing') {
                renderInvoicesTable();
                renderDeliveriesTable();
                renderDeliveredTable();
            }
        } catch (e) {
            console.warn('Could not refresh billing UI after load:', e);
        }
    } catch (error) {
        console.error('Error loading data from Firestore:', error);
    }
}

// Helper function to load a collection
async function loadCollection(collectionRef) {
    try {
        const snapshot = await collectionRef.get();
        const data = [];
        snapshot.forEach(doc => {
            data.push({ id: doc.id, ...doc.data() });
        });
        return data;
    } catch (error) {
        console.error('Error loading collection:', error);
        return [];
    }
}

// Load a top-level collection (globally shared)
async function loadCollectionByOrg(collectionName) {
    try {
        const snapshot = await db.collection(collectionName).get();
        const data = [];
        snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
        return data;
    } catch (error) {
        console.error('Error loading collection:', collectionName, error);
        return [];
    }
}

// ==========================================
// UTILITY FUNCTIONS: Debouncing & Optimization
// ==========================================

// Debounce timer for attendance syncs to batch rapid toggles
let attendanceSyncTimer = null;
const pendingAttendanceChanges = new Set();

// Debounce helper: delay and batch function calls
function createDebounce(func, delay = 300) {
    let timeoutId = null;
    return function debounced(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), delay);
    };
}

// ==========================================
// FIRESTORE DATA FUNCTIONS
// ==========================================

// Save all data to Firestore (globally shared top-level collections)
async function syncDataToFirestore() {
    try {
        if (!AppState.currentUser?.uid) return;

        // Save all collections to top-level shared collections
        await saveCollectionTopLevel(FIRESTORE_COLLECTIONS.orders, AppState.orders || []);
        await saveCollectionTopLevel(FIRESTORE_COLLECTIONS.jobOrders, AppState.jobOrders || []);
        await saveCollectionTopLevel(FIRESTORE_COLLECTIONS.productions, AppState.productions || []);
        await saveCollectionTopLevel(FIRESTORE_COLLECTIONS.billings, AppState.billings || []);
        await saveCollectionTopLevel(FIRESTORE_COLLECTIONS.deliveries, AppState.deliveries || []);
        await saveCollectionTopLevel(FIRESTORE_COLLECTIONS.employees, AppState.employees || []);
        await saveCollectionTopLevel(FIRESTORE_COLLECTIONS.payrolls, AppState.payrolls || []);
        await saveCollectionTopLevel('inventory_management', AppState.inventoryManagementItems || []);
        await saveCollectionTopLevel('inventory_catalog', AppState.inventoryCatalogItems || []);
        await saveCollectionTopLevel('inventory_deduction_history', AppState.inventoryDeductionHistory || []);
        await saveCollectionTopLevel('employee_attendance', AppState.employeeAttendance || []);

        console.log('✓ Data synced to Firestore (globally shared)');
    } catch (error) {
        console.error('Error syncing data to Firestore:', error);
    }
}

// Helper function to save a collection
async function saveCollection(collectionRef, data) {
    try {
        // Get all existing docs to delete those not in the current data
        const existingSnapshot = await collectionRef.get();
        const existingIds = new Set(existingSnapshot.docs.map(doc => doc.id));
        const currentIds = new Set(data.map(item => item.id || item.orderId || item.employeeId || item.productionId || ''));

        // Delete documents that are no longer in data
        for (const docId of existingIds) {
            if (!currentIds.has(docId)) {
                await collectionRef.doc(docId).delete();
            }
        }

        // Helper to remove undefined fields (Firestore rejects undefined)
        function sanitizeForFirestore(value) {
            if (value === undefined) return null;
            if (value === null) return null;
            if (Array.isArray(value)) return value.map(sanitizeForFirestore);
            if (value instanceof Date) return value; // Firestore accepts JS Date
            if (typeof value === 'object') {
                const out = {};
                for (const k of Object.keys(value)) {
                    const v = value[k];
                    if (v === undefined) continue; // skip undefined
                    const sv = sanitizeForFirestore(v);
                    if (sv === undefined) continue;
                    out[k] = sv;
                }
                return out;
            }
            return value;
        }

        // Save or update all current items (sanitize to remove undefined fields)
        for (const item of data) {
            const docId = item.id || item.orderId || item.employeeId || item.productionId || Date.now().toString();
            const docRef = collectionRef.doc(docId);
            const safeItem = sanitizeForFirestore(item);
            await docRef.set(safeItem, { merge: true });
        }
    } catch (error) {
        console.error('Error saving collection to Firestore:', error);
    }
}

// Save a top-level collection (globally shared)
async function saveCollectionTopLevel(collectionName, data) {
    try {
        // Query all existing docs in this collection
        const existingSnapshot = await db.collection(collectionName).get();
        const existingIds = new Set(existingSnapshot.docs.map(doc => doc.id));
        const currentIds = new Set(data.map(item => item.id || item.orderId || item.employeeId || item.productionId || ''));

        // Delete documents that are no longer present
        for (const doc of existingSnapshot.docs) {
            if (!currentIds.has(doc.id)) {
                await doc.ref.delete();
            }
        }

        // Helper to sanitize
        function sanitizeForFirestore(value) {
            if (value === undefined) return null;
            if (value === null) return null;
            if (Array.isArray(value)) return value.map(sanitizeForFirestore);
            if (value instanceof Date) return value;
            if (typeof value === 'object') {
                const out = {};
                for (const k of Object.keys(value)) {
                    const v = value[k];
                    if (v === undefined) continue;
                    const sv = sanitizeForFirestore(v);
                    if (sv === undefined) continue;
                    out[k] = sv;
                }
                return out;
            }
            return value;
        }

        // Upsert items (no orgId field needed)
        for (const item of data) {
            const docId = item.id || item.orderId || item.employeeId || item.productionId || Date.now().toString();
            const docRef = db.collection(collectionName).doc(docId);
            const safeItem = sanitizeForFirestore(item);
            await docRef.set(safeItem, { merge: true });
        }
    } catch (error) {
        console.error('Error saving top-level collection:', collectionName, error);
    }
}

// Cleanup function to delete all inventory data
async function clearAllInventory() {
    if (!confirm('⚠️ WARNING: This will DELETE all inventory items. Are you sure?')) {
        return;
    }

    try {
        showLoading('Clearing inventory...');
        console.log('📝 Clearing all inventory...');

        // Clear memory
        AppState.inventoryManagementItems = [];
        AppState.inventoryCatalogItems = [];
        AppState.inventoryUsageHistory = [];

        // Clear from Firestore
        console.log('Deleting all items from inventory_management...');
        const invSnapshot = await db.collection('inventory_management').get();
        for (const doc of invSnapshot.docs) {
            await doc.ref.delete();
        }

        console.log('Deleting all items from inventory_catalog...');
        const catSnapshot = await db.collection('inventory_catalog').get();
        for (const doc of catSnapshot.docs) {
            await doc.ref.delete();
        }

        console.log('Deleting all items from inventory_usage_history...');
        const histSnapshot = await db.collection('inventory_usage_history').get();
        for (const doc of histSnapshot.docs) {
            await doc.ref.delete();
        }

        hideLoading();
        showMessage('✅ Success', 'All inventory data has been cleared', 'success');
        console.log('✓ Inventory cleared successfully');

        // Refresh UI
        if (typeof loadInventoryContent === 'function') {
            loadInventoryContent();
        }
    } catch (error) {
        hideLoading();
        console.error('❌ Error clearing inventory:', error);
        showMessage('❌ Error', 'Failed to clear inventory: ' + error.message, 'error');
    }
}

// Setup real-time listeners for Firestore collections (globally shared)
function setupRealtimeListener() {
    if (!AppState.currentUser?.uid) return;

    // Collect unsubscribe functions so we can detach listeners on logout
    const unsubscribers = [];

    // Orders
    unsubscribers.push(db.collection(FIRESTORE_COLLECTIONS.orders).onSnapshot(
        snapshot => {
            AppState.orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            console.log('✓ Orders updated from Firestore (org)');
            if (document.getElementById('dashOrderCount')) {
                updateDashboardStats();
            }
        },
        error => { if (AppState.signingOut || !auth.currentUser) return; console.error('Error listening to orders:', error); }
    ));

    // Job Orders
    unsubscribers.push(db.collection(FIRESTORE_COLLECTIONS.jobOrders).onSnapshot(
        snapshot => {
            AppState.jobOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },
        error => { if (AppState.signingOut || !auth.currentUser) return; console.error('Error listening to jobOrders:', error); }
    ));

    // Productions
    unsubscribers.push(db.collection(FIRESTORE_COLLECTIONS.productions).onSnapshot(
        snapshot => {
            AppState.productions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (document.getElementById('dashProductionCount')) {
                updateDashboardStats();
            }
        },
        error => { if (AppState.signingOut || !auth.currentUser) return; console.error('Error listening to productions:', error); }
    ));

    // Billings
    unsubscribers.push(db.collection(FIRESTORE_COLLECTIONS.billings).onSnapshot(
        snapshot => {
            AppState.billings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },
        error => { if (AppState.signingOut || !auth.currentUser) return; console.error('Error listening to billings:', error); }
    ));

    // Deliveries
    unsubscribers.push(db.collection(FIRESTORE_COLLECTIONS.deliveries).onSnapshot(
        snapshot => {
            AppState.deliveries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },
        error => { if (AppState.signingOut || !auth.currentUser) return; console.error('Error listening to deliveries:', error); }
    ));

    // Employees
    unsubscribers.push(db.collection(FIRESTORE_COLLECTIONS.employees).onSnapshot(
        snapshot => {
            AppState.employees = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            updatePayrollTabCards();
        },
        error => { if (AppState.signingOut || !auth.currentUser) return; console.error('Error listening to employees:', error); }
    ));

    // Payrolls
    unsubscribers.push(db.collection(FIRESTORE_COLLECTIONS.payrolls).onSnapshot(
        snapshot => {
            AppState.payrolls = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            updatePayrollTabCards();
        },
        error => { if (AppState.signingOut || !auth.currentUser) return; console.error('Error listening to payrolls:', error); }
    ));

    // Employee Attendance
    unsubscribers.push(db.collection('employee_attendance').onSnapshot(
        snapshot => {
            AppState.employeeAttendance = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            updatePayrollTabCards();
        },
        error => { if (AppState.signingOut || !auth.currentUser) return; console.error('Error listening to employee_attendance:', error); }
    ));

    // Inventory Management
    unsubscribers.push(db.collection('inventory_management').onSnapshot(
        snapshot => {
            AppState.inventoryManagementItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (document.getElementById('dashInventoryCount')) {
                updateDashboardStats();
            }
        },
        error => { if (AppState.signingOut || !auth.currentUser) return; console.error('Error listening to inventory_management:', error); }
    ));

    // Inventory Catalog
    unsubscribers.push(db.collection('inventory_catalog').onSnapshot(
        snapshot => {
            AppState.inventoryCatalogItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },
        error => { if (AppState.signingOut || !auth.currentUser) return; console.error('Error listening to inventory_catalog:', error); }
    ));

    // Store a single unsubscribe function that detaches all listeners
    AppState.realtimeListenerUnsubscribe = () => {
        try {
            unsubscribers.forEach(u => { try { u(); } catch (e) { } });
        } finally {
            AppState.realtimeListenerUnsubscribe = null;
        }
    };

    console.log('✓ Real-time data sync enabled with Firestore (globally shared)');
}

// ==========================================
// APP STATE
// ==========================================
const AppState = {
    currentPage: 'login',
    currentUser: null,
    realtimeListenerUnsubscribe: null,
    isRegistering: false,
    inventoryManagementItems: [],
    inventoryCatalogItems: [],
    inventoryDeductionHistory: [],
    orders: [],
    jobOrders: [],
    productions: [],
    billings: [],
    deliveries: [],
    employees: [],
    payrolls: [],
    employeeAttendance: [],
    roleSalaries: {
        'Admin': 35000,
        'Production Manager': 30000,
        'Quality Inspector': 20000,
        'Staff': 15000,
        'Driver': 18000,
        'Warehouse Staff': 14000,
        'Accountant': 28000
    },
    orderCounter: 1004,
    jobCounter: 5004,
    currentOrderData: {},
    currentStep: 1
};

// ⚠️ Do NOT initialize anything here - wait for Firebase to be ready in DOMContentLoaded

// ==========================================
// CONSTANTS
// ==========================================

// Size fabric multipliers for accurate estimation
const SIZE_MULTIPLIERS = {
    'XS': 0.85, 'S': 0.9, 'M': 1.0, 'L': 1.1,
    'XL': 1.2, 'XXL': 1.3, '3XL': 1.4
};

// Base fabric usage per garment (in meters)
const BASE_FABRIC_USAGE = {
    'T-Shirt': 1.2, 'Polo Shirt': 1.5, 'Dress Shirt': 1.8,
    'Pants': 2.0, 'Jacket': 2.5, 'Uniform': 2.2, 'Custom': 1.5
};

// Base pricing per garment type (₱)
const BASE_PRICING = {
    'T-Shirt': { fabric: 80, labor: 50, overhead: 20, profit: 30 },
    'Polo Shirt': { fabric: 120, labor: 80, overhead: 30, profit: 50 },
    'Dress Shirt': { fabric: 150, labor: 100, overhead: 40, profit: 60 },
    'Pants': { fabric: 180, labor: 120, overhead: 50, profit: 70 },
    'Jacket': { fabric: 300, labor: 200, overhead: 80, profit: 120 },
    'Uniform': { fabric: 200, labor: 150, overhead: 60, profit: 90 },
    'Custom': { fabric: 100, labor: 80, overhead: 30, profit: 50 }
};

// ==========================================
// PAGE NAVIGATION SYSTEM - FIXED
// ==========================================
function navigateTo(pageName) {
    const loginPage = document.getElementById('loginPage');
    const mainLayout = document.getElementById('mainLayout');

    document.querySelectorAll('.nav-link').forEach(item => item.classList.remove('active'));

    if (pageName === 'login') {
        loginPage.style.display = 'flex';
        loginPage.classList.add('active');
        mainLayout.style.display = 'none';
        mainLayout.classList.remove('active');
        AppState.currentPage = 'login';
    } else {
        loginPage.style.display = 'none';
        loginPage.classList.remove('active');
        mainLayout.style.display = 'flex';
        mainLayout.classList.add('active');

        const navItem = document.querySelector(`[data-page="${getPageDataAttribute(pageName)}"]`);
        if (navItem) navItem.classList.add('active');

        loadPageContent(pageName);
        AppState.currentPage = pageName;
    }
}

function getPageDataAttribute(pageName) {
    const pageMap = {
        'dashboard': 'dashboard', 'orders': 'order_job', 'production': 'Production_Quality',
        'inventory': 'inventory', 'billing': 'billing_delivery',
        'payroll': 'Employee_Payroll', 'reports': 'reports'
    };
    return pageMap[pageName] || pageName;
}

// ==========================================
// DYNAMIC CONTENT LOADER
// ==========================================
function loadPageContent(pageName) {
    const pageTitle = document.getElementById('pageTitle');
    const pageSubtitle = document.getElementById('pageSubtitle');

    const pageTitles = {
        'dashboard': { title: 'Dashboard', subtitle: 'Overview of your system' },
        'orders': { title: 'Order & Job Tracking', subtitle: 'Manage orders and production jobs' },
        'quotation': { title: 'New Order & Quotation', subtitle: 'Create order and quotation' },
        'production': { title: 'Production & Quality', subtitle: 'Monitor production and quality control' },
        'inventory': { title: 'Inventory Management', subtitle: 'Track and manage inventory items' },
        'billing': { title: 'Billing & Delivery', subtitle: 'Handle billing and deliveries' },
        'packaging': { title: 'Packaging Management', subtitle: 'Manage final packing and order readiness' },
        'payroll': { title: 'Employee & Payroll', subtitle: 'Manage employees and payroll' },
        'reports': { title: 'Reports & Analytics', subtitle: 'View reports and analytics' }
    };

    if (pageTitles[pageName]) {
        pageTitle.textContent = pageTitles[pageName].title;
        pageSubtitle.textContent = pageTitles[pageName].subtitle;
    }

    switch (pageName) {
        case 'dashboard': loadDashboardContent(); break;
        case 'orders': loadOrdersContent(); break;
        case 'quotation': loadQuotationPageContent(); break;
        case 'production': loadProductionContent(); break;
        case 'inventory': loadInventoryContent(); break;
        case 'billing': loadBillingContent(); break;
        case 'payroll': loadPayrollContent(); break;
        case 'packaging': loadPackagingContent(); break;
        case 'reports': loadReportsContent(); break;
        case 'notifications': loadSMSNotificationsContent(); break;
    }

    // Ensure role permissions are applied for current page
    applyRolePermissions();

    // Update header actions (inject page-specific buttons)
    updateHeaderForPage(pageName);
}

function updateHeaderForPage(pageName) {
    const headerActions = document.querySelector('.top-bar .header-actions');
    if (!headerActions) return;
    // remove existing injected button if present
    const existing = document.getElementById('newOrderHeaderBtn');
    if (existing) existing.remove();

    if (pageName === 'orders') {
        const btn = document.createElement('button');
        btn.className = 'header-btn new-order-btn';
        btn.id = 'newOrderHeaderBtn';
        btn.title = 'New Order & Quotation';
        btn.innerHTML = `<span class="btn-icon">✨</span><span>New Order & Quotation</span>`;
        btn.addEventListener('click', () => navigateTo('quotation'));
        headerActions.appendChild(btn);
    }
}

// ==========================================
// LOGIN SYSTEM
// ==========================================
const ROLE_PERMISSIONS = {
    administrator: {
        name: 'Administrator',
        allowedPages: ['order_job', 'Production_Quality', 'inventory', 'billing_delivery', 'Employee_Payroll', 'reports'],
        allowedModules: ['orderTracking', 'productionQuality', 'inventoryManagement', 'billingDelivery', 'employeePayroll', 'reportsAnalytics']
    },
    staff: {
        name: 'Staff',
        allowedPages: ['main', 'order_job', 'billing_delivery', 'Production_Quality'],
        allowedModules: ['orderTracking', 'billingDelivery', 'productionQuality'],
        restrictedPages: ['inventory', 'Employee_Payroll', 'reports']
    }
};

const DEMO_USERS = {
    administrator: { username: 'admin', password: 'admin123', role: 'administrator' },
    staff: { username: 'staff', password: 'staff123', role: 'staff' }
};

let selectedRole = 'admin';

document.addEventListener('DOMContentLoaded', async () => {
    console.log('📄 DOM Content Loaded - Waiting for Firebase SDK...');

    // Show loading indicator
    showLoading('Initializing Firebase Services...');

    // Wait for Firebase to be ready with a 30-second timeout
    const firebaseInitTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firebase initialization timeout (30 seconds)')), 30000)
    );

    try {
        if (window.initializeFirebaseSDK) {
            console.log('⏳ Initializing Firebase SDK...');
            await Promise.race([
                window.initializeFirebaseSDK(),
                firebaseInitTimeout
            ]);
            console.log('✓ Firebase SDK initialization completed successfully');
        } else {
            throw new Error('Firebase config script not loaded - initializeFirebaseSDK function missing');
        }
    } catch (error) {
        hideLoading();
        console.error('❌ Firebase initialization failed:', error.message);
        alert(`⚠️ Firebase Initialization Failed\n\n${error.message}\n\nPlease:\n1. Check your internet connection\n2. Verify Firebase CDN is accessible\n3. Refresh the page to try again`);
    }

    // Initialize Firebase service references from window object
    auth = window.auth;
    db = window.db;
    storage = window.storage;

    let initErrors = [];

    if (!auth) {
        console.error('❌ Firebase Auth service not available');
        initErrors.push('Firebase Auth');
    } else {
        console.log('✓ Firebase Auth initialized');
    }

    if (!db) {
        console.error('❌ Firestore service not available');
        initErrors.push('Firestore');
    } else {
        console.log('✓ Firestore initialized');
    }

    if (!storage) {
        console.warn('⚠️ Firebase Storage not available (optional)');
    } else {
        console.log('✓ Firebase Storage initialized');
    }

    if (initErrors.length > 0) {
        hideLoading();
        alert(`⚠️ Critical services failed to initialize:\n${initErrors.join(', ')}\n\nPlease refresh the page.`);
        return;
    }

    console.log('%c✓✓✓ GoldenThreads IMS Ready! ✓✓✓', 'color: #D4AF37; font-size: 14px; font-weight: bold;');
    console.log('All Firebase services and DOM ready');

    // Keep showing loading while we check auth/session and load initial data
    showLoading('Checking session...');
    initializeLoginPage();
    checkExistingSession();

    // Initialize Firestore when Firebase is ready (will run in background)
    if (window.initializeFirestore) {
        initializeFirestore();
    }
});

function initializeLoginPage() {
    const roleButtons = document.querySelectorAll('.role-btn');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const forgotForm = document.getElementById('forgotForm');

    roleButtons.forEach(button => {
        button.addEventListener('click', () => {
            roleButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            selectedRole = button.dataset.role;
            clearLoginErrors();
        });
    });

    // Login form
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    // Register form
    if (registerForm) registerForm.addEventListener('submit', handleRegister);

    // Forgot password form
    if (forgotForm) forgotForm.addEventListener('submit', handleForgotPassword);

    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');

    if (emailInput) emailInput.addEventListener('input', () => clearFieldError(emailInput, document.getElementById('emailError')));
    if (passwordInput) passwordInput.addEventListener('input', () => clearFieldError(passwordInput, document.getElementById('passwordError')));

    // Reset submit button to ensure clean state
    const submitBtn = document.querySelector('.sign-in-btn');
    if (submitBtn) {
        submitBtn.disabled = false;
        if (submitBtn.querySelector('span')) {
            submitBtn.querySelector('span').textContent = 'LOG IN';
        }
        submitBtn.style.background = '';
    }
    // Enable password show/hide toggles for any password inputs on the login/register/forgot forms
    try { enablePasswordToggles(); } catch (e) { console.error('enablePasswordToggles init error', e); }
}

// ==========================================
// AUTH TAB SWITCHING
// ==========================================
function switchAuthTab(tabName) {
    // Hide all auth forms
    const forms = document.querySelectorAll('.auth-form-container');
    forms.forEach(form => form.classList.remove('active'));

    // Remove active class from all tab buttons
    const tabBtns = document.querySelectorAll('.auth-tab-btn');
    tabBtns.forEach(btn => btn.classList.remove('active'));

    // Show selected form
    const selectedForm = document.getElementById(tabName + 'Tab');
    if (selectedForm) {
        selectedForm.classList.add('active');
    }

    // Activate selected tab button
    const selectedBtn = document.querySelector(`.auth-tab-btn[data-tab="${tabName}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }

    // Clear any error messages
    clearLoginErrors();
}

// ==========================================
// FIREBASE AUTHENTICATION FUNCTIONS
// ==========================================
// All authentication is now handled by Firebase Auth
// See handleLogin(), handleRegister(), handleLogout() for implementation

async function firebaseForgotPassword(email) {
    try {
        await auth.sendPasswordResetEmail(email);
        return { success: true, message: 'Password reset email sent. Check your inbox.' };
    } catch (error) {
        console.error('Firebase forgot password error:', error.message);
        return { success: false, error: error.message };
    }
}

// ==========================================
// FIRESTORE DATA SYNCHRONIZATION
// ==========================================

// Initialize app (using Firestore, no local initialization needed)
async function initializeSampleData() {
    console.log('✓ Using Firestore for all data - no local sample data needed');
}

// Clean up real-time listeners and user state
function cleanupUserSession() {
    // Unsubscribe from real-time listener
    if (AppState.realtimeListenerUnsubscribe) {
        AppState.realtimeListenerUnsubscribe();
        AppState.realtimeListenerUnsubscribe = null;
    }
    // Clear user data
    AppState.currentUser = null;
}

function handleLogin(e) {
    e.preventDefault();
    clearLoginErrors();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    let hasError = false;

    if (!username || username.length < 3) {
        showFieldError(document.getElementById('username'), document.getElementById('usernameError'), 'Please enter your username');
        hasError = true;
    }

    if (!password || password.length < 6) {
        showFieldError(document.getElementById('password'), document.getElementById('passwordError'), 'Password must be at least 6 characters');
        hasError = true;
    }

    if (hasError) return;

    const submitBtn = document.querySelector('.sign-in-btn');
    submitBtn.disabled = true;
    submitBtn.querySelector('span').textContent = 'LOGGING IN...';
    showLoading('Verifying credentials...');

    // Step 1: Lookup user by username in Firestore to get their actual email
    console.log('🔍 Looking up user:', username);
    db.collection(FIRESTORE_COLLECTIONS.users)
        .where('username', '==', username)
        .limit(1)
        .get()
        .then(querySnapshot => {
            if (querySnapshot.empty) {
                // User not found in Firestore, try fallback email format
                console.log('⚠️ User not found in Firestore, trying fallback email format');
                let email = username;
                if (!email.includes('@')) {
                    email = username + '@goldenthreads.local';
                }
                return Promise.resolve({ email: email, user: null });
            }

            const userDoc = querySnapshot.docs[0];
            const userData = userDoc.data();
            console.log('✓ User found in Firestore:', userData.email, 'Role:', userData.role);
            return Promise.resolve({ email: userData.email, user: userData });
        })
        .catch(lookupError => {
            console.error('❌ Error looking up user in Firestore:', lookupError.message);
            hideLoading();
            showFormError('Database error during login. Please check your connection and try again.');
            submitBtn.disabled = false;
            submitBtn.querySelector('span').textContent = 'LOG IN';
            throw lookupError;
        })
        .then(({ email, user }) => {
            // Step 2: Authenticate with Firebase using the actual registered email
            console.log('🔐 Authenticating with Firebase:', email);
            return auth.signInWithEmailAndPassword(email, password)
                .then(userCredential => {
                    return { userCredential, user };
                });
        })
        .then(({ userCredential, user }) => {
            hideLoading();

            // Step 3: Load user data from Firestore
            const userId = userCredential.user.uid;
            return db.collection(FIRESTORE_COLLECTIONS.users).doc(userId).get().then(doc => {
                if (doc.exists) {
                    AppState.currentUser = {
                        uid: doc.id,
                        username: doc.data().username,
                        fullName: doc.data().fullName,
                        role: doc.data().role,
                        displayName: doc.data().fullName,
                        email: doc.data().email
                    };
                } else {
                    // Fallback: create user profile if it doesn't exist (shouldn't happen)
                    AppState.currentUser = {
                        uid: userId,
                        username: username,
                        fullName: username,
                        role: 'staff',
                        displayName: username,
                        email: userCredential.user.email
                    };
                    db.collection(FIRESTORE_COLLECTIONS.users).doc(userId).set(AppState.currentUser);
                }

                console.log('✓ User loaded:', AppState.currentUser.username, 'Role:', AppState.currentUser.role);
                console.log('📊 Selected role on login page:', selectedRole);

                // Step 4: Validate that user's role matches the selected role on login page
                if (selectedRole && AppState.currentUser.role !== selectedRole) {
                    hideLoading();
                    const errorMsg = `Access denied. Your account is registered as ${AppState.currentUser.role.toUpperCase()}, not ${selectedRole.toUpperCase()}.\n\nPlease select the correct role (${AppState.currentUser.role.toUpperCase()}) and try again.`;
                    console.error('❌ Role mismatch:', errorMsg);
                    showFormError(errorMsg);
                    submitBtn.disabled = false;
                    submitBtn.querySelector('span').textContent = 'LOG IN';
                    // Sign out the user since role doesn't match
                    auth.signOut();
                    return;
                }

                submitBtn.querySelector('span').textContent = 'SUCCESS!';
                submitBtn.style.background = '#27AE60';

                setTimeout(() => {
                    navigateTo('dashboard');
                    initializeMainLayout();
                    setupRealtimeListener(); // Start real-time sync
                    applyRolePermissions();
                }, 500);
            });
        })
        .catch(error => {
            hideLoading();
            console.error('❌ Login error:', error.code, error.message);
            let errorMessage = 'Login failed. Please check your credentials.';

            if (error.code === 'auth/user-not-found') {
                errorMessage = 'Username not found. Please check and try again.';
            } else if (error.code === 'auth/wrong-password') {
                errorMessage = 'Incorrect password. Please try again.';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Invalid username format.';
            } else if (error.code === 'auth/user-disabled') {
                errorMessage = 'This account has been disabled.';
            }

            showFormError(errorMessage);
            submitBtn.disabled = false;
            submitBtn.querySelector('span').textContent = 'LOG IN';
        });
}

function handleRegister(e) {
    e.preventDefault();
    clearLoginErrors();

    const fullName = document.getElementById('reg_fullname').value.trim();
    const username = document.getElementById('reg_username').value.trim();
    const emailInput = document.getElementById('reg_email') ? document.getElementById('reg_email').value.trim() : '';
    const password = document.getElementById('reg_password').value;
    const confirmPassword = document.getElementById('reg_confirm_password').value;
    const role = document.getElementById('reg_role').value;

    let hasError = false;

    if (!fullName || fullName.length < 3) {
        showFieldError(document.getElementById('reg_fullname'), document.getElementById('fullnameError'), 'Please enter your full name');
        hasError = true;
    }

    if (!username || username.length < 3) {
        showFieldError(document.getElementById('reg_username'), document.getElementById('regUsernameError'), 'Username must be at least 3 characters');
        hasError = true;
    }

    if (!password || password.length < 6) {
        showFieldError(document.getElementById('reg_password'), document.getElementById('regPasswordError'), 'Password must be at least 6 characters');
        hasError = true;
    }

    if (password !== confirmPassword) {
        showFieldError(document.getElementById('reg_confirm_password'), document.getElementById('confirmPasswordError'), 'Passwords do not match');
        hasError = true;
    }

    if (!role) {
        showFieldError(document.getElementById('reg_role'), document.getElementById('roleError'), 'Please select a role');
        hasError = true;
    }

    // Validate email
    let email = '';
    if (!emailInput) {
        showFieldError(document.getElementById('reg_email'), document.getElementById('regEmailError'), 'Please enter an email address');
        hasError = true;
    } else {
        email = emailInput;
        // basic email format check
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showFieldError(document.getElementById('reg_email'), document.getElementById('regEmailError'), 'Please enter a valid email address');
            hasError = true;
        }
    }

    if (hasError) return;

    const submitBtn = document.querySelector('#registerTab button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.querySelector('span').textContent = 'CREATING ACCOUNT...';
    }
    showLoading('Creating account...');

    // Use Firebase to create account with provided email
    auth.createUserWithEmailAndPassword(email, password)
        .then(userCredential => {
            const userId = userCredential.user.uid;
            console.log('✓ User created in Firebase Auth:', userId);

            // Save user profile to Firestore
            const userProfile = {
                uid: userId,
                username: username,
                fullName: fullName,
                email: email,
                role: role,
                createdAt: new Date().toISOString()
            };

            console.log('📝 Saving user profile to Firestore:', userProfile);
            return db.collection(FIRESTORE_COLLECTIONS.users).doc(userId).set(userProfile);
        })
        .then(() => {
            console.log('✓ User profile saved to Firestore successfully');
            hideLoading();
            if (submitBtn) {
                submitBtn.className = 'sign-in-btn';
                submitBtn.querySelector('span').textContent = 'ACCOUNT CREATED!';
                submitBtn.style.background = '#27AE60';
            }

            showMessage('Success', 'Account created successfully! You can now log in.', 'success');

            setTimeout(() => {
                // Clear form
                const registerForm = document.getElementById('registerForm');
                if (registerForm) registerForm.reset();
                // Switch to login tab
                switchAuthTab('login');
                // Reset button
                if (submitBtn) {
                    submitBtn.className = 'sign-in-btn';
                    submitBtn.querySelector('span').textContent = 'CREATE ACCOUNT';
                    submitBtn.style.background = '';
                    submitBtn.disabled = false;
                }
            }, 2000);
        })
        .catch(error => {
            hideLoading();
            console.error('❌ Registration error:', error.code, error.message);
            let errorMessage = 'Registration failed. Please try again.';

            // Handle Auth errors
            if (error.code === 'auth/email-already-in-use') {
                errorMessage = 'This email is already registered. Please use a different email or try logging in.';
            } else if (error.code === 'auth/weak-password') {
                errorMessage = 'Password is too weak. Please use a stronger password (at least 6 characters).';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Invalid email format. Please enter a valid email address.';
            }
            // Handle Firestore errors
            else if (error.code === 'permission-denied') {
                errorMessage = 'Permission denied. Unable to save profile to database. Please contact administrator.';
            } else if (error.code === 'firestore/failed-precondition' || error.message?.includes('FAILED_PRECONDITION')) {
                errorMessage = 'Database error. Please check your Firebase configuration and rules.';
            } else if (error.message && error.message.includes('Firestore')) {
                errorMessage = 'Database error: ' + error.message;
            }

            console.error('Full error object:', error);
            showFormError(errorMessage, 'registerFormError');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.querySelector('span').textContent = 'CREATE ACCOUNT';
            }
        });
}

// ==========================================
// AUTH HANDLERS - FIREBASE
// ==========================================

function handleForgotPassword(e) {
    e.preventDefault();
    clearLoginErrors();

    const email = document.getElementById('forgot_email').value.trim();
    const forgotFormError = document.getElementById('forgotFormError');
    const forgotFormSuccess = document.getElementById('forgotFormSuccess');

    if (!email || email.length < 5) {
        showFieldError(document.getElementById('forgot_email'), document.getElementById('forgotEmailError'), 'Please enter a valid email address');
        return;
    }

    const submitBtn = document.querySelector('#forgotTab button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.querySelector('span').textContent = 'SENDING...';
    }

    // Convert username to email format if needed
    let resetEmail = email;
    if (!email.includes('@')) {
        resetEmail = email + '@goldenthreads.local';
    }

    showLoading('Sending password reset email...');

    auth.sendPasswordResetEmail(resetEmail)
        .then(() => {
            hideLoading();
            if (forgotFormError) forgotFormError.style.display = 'none';
            if (forgotFormSuccess) {
                forgotFormSuccess.textContent = '✓ Password reset email sent! Check your inbox for instructions.';
                forgotFormSuccess.style.display = 'block';
            }

            // Reset form after 3 seconds
            setTimeout(() => {
                document.getElementById('forgotForm').reset();
                if (forgotFormSuccess) forgotFormSuccess.style.display = 'none';
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.querySelector('span').textContent = 'SEND RESET EMAIL';
                }
                // Switch back to login tab
                switchAuthTab('login');
            }, 3000);
        })
        .catch(error => {
            hideLoading();
            let errorMessage = 'Failed to send reset email. Please try again.';

            if (error.code === 'auth/user-not-found') {
                errorMessage = 'No account found with this email address.';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Invalid email address format.';
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = 'Too many attempts. Please try again later.';
            }

            if (forgotFormError) {
                forgotFormError.textContent = errorMessage;
                forgotFormError.style.display = 'block';
            }
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.querySelector('span').textContent = 'SEND RESET EMAIL';
            }
        });
}

function authenticateUser(username, password, role) {
    const demoUser = DEMO_USERS[role];
    if (demoUser && demoUser.username === username && demoUser.password === password) {
        return { success: true, user: { username, role, displayName: ROLE_PERMISSIONS[role].name } };
    }
    return { success: false, message: 'Invalid username or password' };
}

function createUserSession(user) {
    const sessionData = {
        username: user.username,
        role: user.role,
        displayName: user.displayName,
        permissions: ROLE_PERMISSIONS[user.role],
        loginTime: new Date().toISOString(),
        sessionId: Date.now().toString(36) + Math.random().toString(36).substr(2)
    };

    sessionStorage.setItem('userSession', JSON.stringify(sessionData));
    AppState.currentUser = sessionData;
}

function checkExistingSession() {
    // Use Firebase Auth to check if user is logged in
    auth.onAuthStateChanged(user => {
        if (user) {
            // User is logged in, load their Firestore data
            const userId = user.uid;
            db.collection(FIRESTORE_COLLECTIONS.users).doc(userId).get()
                .then(doc => {
                    if (doc.exists) {
                        AppState.currentUser = {
                            uid: doc.id,
                            username: doc.data().username,
                            fullName: doc.data().fullName,
                            role: doc.data().role,
                            displayName: doc.data().fullName,
                            email: user.email
                        };
                    } else {
                        // Create user profile if missing
                        const username = user.email.split('@')[0];
                        AppState.currentUser = {
                            uid: userId,
                            username: username,
                            fullName: username,
                            role: 'staff',
                            displayName: username,
                            email: user.email
                        };
                        db.collection(FIRESTORE_COLLECTIONS.users).doc(userId).set(AppState.currentUser);
                    }

                    // Load all user data then show app
                    loadAllDataFromFirestore().then(() => {
                        navigateTo('dashboard');
                        initializeMainLayout();
                        setupRealtimeListener();
                        applyRolePermissions();
                        hideLoading();
                    }).catch(err => {
                        console.error('Error loading initial data:', err);
                        navigateTo('login');
                        hideLoading();
                    });
                })
                .catch(error => {
                    console.error('Error loading user profile:', error);
                    navigateTo('login');
                    hideLoading();
                });
        } else {
            // No user logged in - show login
            navigateTo('login');
            hideLoading();
        }
    });
}

function clearLoginErrors() {
    document.querySelectorAll('.error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('.form-group input').forEach(input => input.classList.remove('error'));
    const formError = document.getElementById('formError');
    if (formError) formError.style.display = 'none';
}

function clearFieldError(input, errorElement) {
    input.classList.remove('error');
    if (errorElement) errorElement.textContent = '';
}

function showFieldError(input, errorElement, message) {
    input.classList.add('error');
    if (errorElement) errorElement.textContent = message;
}

function showFormError(message) {
    const formError = document.getElementById('formError');
    if (formError) {
        formError.textContent = message;
        formError.style.display = 'block';
    }
}

// ==========================================
// MAIN LAYOUT INITIALIZATION
// ==========================================
function initializeMainLayout() {
    updateUserDisplay();
    setupUserMenuHandlers();
    applyRolePermissions();
}

function updateUserDisplay() {
    if (!AppState.currentUser) return;

    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    const userAvatarEl = document.getElementById('userAvatar');

    if (userNameEl) userNameEl.textContent = AppState.currentUser.username;
    if (userRoleEl) userRoleEl.textContent = AppState.currentUser.role.charAt(0).toUpperCase() + AppState.currentUser.role.slice(1);
    if (userAvatarEl) userAvatarEl.textContent = AppState.currentUser.username.charAt(0).toUpperCase();
}

function setupUserMenuHandlers() {
    const userInfoTrigger = document.getElementById('userInfoTrigger');
    const userSettingsDropdown = document.getElementById('userSettingsDropdown');
    const logoutBtn = document.getElementById('logoutBtn');

    if (userInfoTrigger && userSettingsDropdown) {
        // Remove any existing listeners by cloning and replacing
        const newTrigger = userInfoTrigger.cloneNode(true);
        userInfoTrigger.parentNode.replaceChild(newTrigger, userInfoTrigger);

        newTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            userSettingsDropdown.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (!userSettingsDropdown.contains(e.target) && !newTrigger.contains(e.target)) {
                userSettingsDropdown.classList.remove('active');
            }
        });
    }

    if (logoutBtn) {
        // Remove existing listener and re-attach
        const newLogoutBtn = logoutBtn.cloneNode(true);
        logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
        newLogoutBtn.addEventListener('click', confirmLogout);
    }
}

function confirmLogout() {
    const modal = createModal('Confirm Logout', `
        <div style="padding:1rem;text-align:center;">
            <div style="margin-bottom:1.5rem;font-size:1.5rem;">
                ⚠️
            </div>
            <p style="font-size:1rem;color:var(--navy-dark);line-height:1.6;margin-bottom:1.5rem;">
                Are you sure you want to log out?
            </p>
            <div style="display:flex;gap:1rem;justify-content:center;">
                <button class="btn-secondary" onclick="closeModal()" style="flex:1;">Cancel</button>
                <button class="btn-primary" onclick="closeModal(); handleLogout();" style="flex:1;">Log Out</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function toggleUserMenu() {
    const dropdown = document.getElementById('userMenuDropdown');
    if (dropdown) {
        dropdown.classList.toggle('active');

        // Close dropdown when clicking outside
        if (dropdown.classList.contains('active')) {
            document.addEventListener('click', closeUserMenuOnClickOutside);
        } else {
            document.removeEventListener('click', closeUserMenuOnClickOutside);
        }
    }
}

function closeUserMenuOnClickOutside(event) {
    const userMenu = document.getElementById('userMenu');
    const dropdown = document.getElementById('userMenuDropdown');

    if (userMenu && dropdown && !userMenu.contains(event.target)) {
        dropdown.classList.remove('active');
        document.removeEventListener('click', closeUserMenuOnClickOutside);
    }
}

function toggleAccountSubmenu() {
    const submenu = document.getElementById('accountSubmenu');
    const arrow = document.querySelector('.submenu-arrow');
    if (submenu) {
        submenu.classList.toggle('active');
        if (arrow) {
            arrow.style.transform = submenu.classList.contains('active') ? 'rotate(90deg)' : 'rotate(0)';
        }
    }
}

function openChangePassword() {
    const userEmail = AppState.currentUser?.email;
    if (!userEmail) {
        showMessage('Error', 'User email not found. Please log in again.', 'error');
        return;
    }
    // Show modal that accepts old password + new password + confirm new password
    const modal = createModal('Change Password', `
        <div>
            <p style="margin-bottom:1.25rem;color:#666;font-size:0.95rem;line-height:1.6;">Change your account password. You will be re-authenticated using your current password.</p>
            <div style="margin-bottom:1rem;">
                <label style="display:block;font-size:0.7rem;font-weight:500;letter-spacing:0.15em;color:var(--navy-dark);text-transform:uppercase;margin-bottom:0.5rem;">Current Password</label>
                <input type="password" id="currentPasswordInput" placeholder="Enter current password" style="width:100%;padding:0.7rem 0.9rem;border:2px solid #DDD;border-radius:6px;font-size:0.95rem;color:var(--navy-dark);transition:all 0.3s ease;box-sizing:border-box;font-family:'Cormorant Garamond',serif;">
            </div>
            <div style="margin-bottom:1rem;">
                <label style="display:block;font-size:0.7rem;font-weight:500;letter-spacing:0.15em;color:var(--navy-dark);text-transform:uppercase;margin-bottom:0.5rem;">New Password</label>
                <input type="password" id="newPasswordInput" placeholder="Enter new password (min 6 chars)" style="width:100%;padding:0.7rem 0.9rem;border:2px solid #DDD;border-radius:6px;font-size:0.95rem;color:var(--navy-dark);transition:all 0.3s ease;box-sizing:border-box;font-family:'Cormorant Garamond',serif;">
            </div>
            <div style="margin-bottom:1rem;">
                <label style="display:block;font-size:0.7rem;font-weight:500;letter-spacing:0.15em;color:var(--navy-dark);text-transform:uppercase;margin-bottom:0.5rem;">Confirm New Password</label>
                <input type="password" id="confirmNewPasswordInput" placeholder="Confirm new password" style="width:100%;padding:0.7rem 0.9rem;border:2px solid #DDD;border-radius:6px;font-size:0.95rem;color:var(--navy-dark);transition:all 0.3s ease;box-sizing:border-box;font-family:'Cormorant Garamond',serif;">
            </div>
            <div id="changePasswordError" style="color:var(--error-red);margin-bottom:1rem;display:none;padding:0.75rem;background:rgba(231,76,60,0.1);border-left:4px solid var(--error-red);border-radius:4px;font-size:0.9rem;"></div>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
                <button type="button" onclick="closeModal()" style="padding:0.7rem 1.5rem;background:#F0F0F0;color:var(--navy-dark);border:2px solid #DDD;border-radius:6px;font-weight:600;cursor:pointer;transition:all 0.2s ease;font-family:'Cormorant Garamond',serif;letter-spacing:0.05em;font-size:0.9rem;">Cancel</button>
                <button type="button" id="changePasswordBtn" onclick="confirmChangePassword()" style="padding:0.7rem 1.5rem;background:linear-gradient(135deg,var(--gold-primary),var(--gold-dark));color:white;border:none;border-radius:6px;font-weight:600;cursor:pointer;transition:all 0.2s ease;font-family:'Cormorant Garamond',serif;letter-spacing:0.05em;font-size:0.9rem;">Change Password</button>
            </div>
        </div>
    `);

    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function openDeleteAccount() {
    const modal = createModal('Delete Account', `
        <div style="padding:1.5rem;text-align:center;">
            <div style="margin-bottom:1rem;font-size:2rem;color:var(--error);">
                ⚠️
            </div>
            <p style="font-size:1rem;color:var(--navy-dark);line-height:1.6;margin-bottom:1rem;">
                Are you sure you want to delete your account? This action cannot be undone.
            </p>
            <p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:1.5rem;">
                All your data will be permanently deleted.
            </p>
            <div style="display:flex;gap:1rem;justify-content:center;">
                <button class="btn-secondary" onclick="closeModal()" style="flex:1;">Cancel</button>
                <button class="btn-danger" onclick="closeModal(); handleDeleteAccount();" style="flex:1;background:var(--error);">Delete Account</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function handleDeleteAccount() {
    // TODO: Implement account deletion logic
    console.log('Delete account handler');
}

const photoInputEl = document.getElementById('inventoryPhoto');
const photoPreviewEl = document.getElementById('inventoryPhotoPreview');
if (photoInputEl && photoPreviewEl) {
    photoInputEl.addEventListener('change', (evt) => {
        const f = evt.target.files && evt.target.files[0];
        if (f) {
            photoPreviewEl.src = URL.createObjectURL(f);
            photoPreviewEl.style.display = 'block';
        } else {
            photoPreviewEl.src = '';
            photoPreviewEl.style.display = 'none';
        }
    });
}

function handleLogout() {
    showLoading('Logging out...');

    // Mark signing out so listeners ignore permission errors during shutdown
    AppState.signingOut = true;

    // Clean up listeners and user session
    cleanupUserSession();

    // Sign out from Firebase
    auth.signOut()
        .then(() => {
            hideLoading();

            AppState.currentPage = 'login';

            const loginForm = document.getElementById('loginForm');
            if (loginForm) loginForm.reset();

            // Reset submit button state
            const submitBtn = document.querySelector('.sign-in-btn');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.querySelector('span').textContent = 'LOG IN';
                submitBtn.style.background = '';
            }

            navigateTo('login');
        })
        .catch(error => {
            hideLoading();
            console.error('Logout error:', error);
            // Force logout even if Firebase error occurs
            AppState.currentPage = 'login';
            navigateTo('login');
        })
        .finally(() => {
            // Clear signing out flag after sign-out flow finishes
            AppState.signingOut = false;
        });
}

// ==========================================
// DELETE ACCOUNT FUNCTIONS
// ==========================================

function openDeleteAccountModal() {
    const modal = createModal('Delete Account', `
        <div style="padding:1.5rem;text-align:center;">
            <div style="margin-bottom:1rem;font-size:2rem;">
                ⚠️
            </div>
            <p style="font-size:1rem;color:var(--navy-dark);line-height:1.6;margin-bottom:1.5rem;font-weight:500;">
                This action will permanently delete your user account and profile (your login credentials).
                Records you created (orders, productions, invoices, inventory adjustments, etc.) will remain in the system and can still be managed by other administrator accounts.
            </p>
            <div style="background:#FFF3CD;border-left:4px solid #FFC107;padding:1rem;margin-bottom:1.5rem;border-radius:4px;text-align:left;">
                <p style="margin:0;font-size:0.9rem;color:#856404;">
                    <strong>Important:</strong>
                </p>
                <ul style="margin:0.5rem 0 0 0;padding-left:1.5rem;font-size:0.85rem;color:#856404;">
                    <li>Your user profile and ability to log in will be removed.</li>
                    <li>Operational data (orders, productions, billings, deliveries, inventory items) will be retained for continuity.</li>
                    <li>If you need your data anonymized or reassigned before deletion, contact an administrator.</li>
                </ul>
            </div>
            <div style="margin-bottom:1.5rem;">
                <label style="display:block;font-size:0.9rem;color:#666;margin-bottom:0.5rem;text-align:left;">
                    Enter your password to confirm deletion:
                </label>
                <input type="password" id="deleteConfirmPassword" placeholder="Enter your password" 
                    style="width:100%;padding:0.75rem;border:1px solid #DDD;border-radius:4px;box-sizing:border-box;font-size:0.9rem;" />
                <span class="error-message" id="deletePasswordError" style="display:block;margin-top:0.25rem;"></span>
            </div>
            <div style="display:flex;gap:1rem;justify-content:center;">
                <button class="btn-secondary" onclick="closeModal()" style="flex:1;">Cancel</button>
                <button class="btn-danger" onclick="handleDeleteAccount()" style="flex:1;background-color:#E74C3C;color:white;padding:0.75rem;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">Delete Account</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function handleDeleteAccount() {
    const password = document.getElementById('deleteConfirmPassword')?.value || '';
    const errorEl = document.getElementById('deletePasswordError');

    if (!password) {
        if (errorEl) {
            errorEl.textContent = 'Please enter your password to confirm';
            errorEl.style.display = 'block';
        }
        return;
    }

    if (!AppState.currentUser?.email) {
        if (errorEl) {
            errorEl.textContent = 'User information not found. Please log out and try again.';
            errorEl.style.display = 'block';
        }
        return;
    }

    showLoading('Deleting account...');

    // Re-authenticate user with password before deletion
    const credential = firebase.auth.EmailAuthProvider.credential(
        AppState.currentUser.email,
        password
    );

    auth.currentUser.reauthenticateWithCredential(credential)
        .then(() => {
            // First, delete all user data from Firestore
            const userId = auth.currentUser.uid;
            const userRef = db.collection(FIRESTORE_COLLECTIONS.users).doc(userId);

            return userRef.delete().then(() => {
                // Then delete the user account
                return auth.currentUser.delete();
            });
        })
        .then(() => {
            hideLoading();
            closeModal();
            showMessage('Success', 'Your account has been permanently deleted.', 'success');

            setTimeout(() => {
                // Clean up and redirect to login
                cleanupUserSession();
                navigateTo('login');
                const loginForm = document.getElementById('loginForm');
                if (loginForm) loginForm.reset();
            }, 2000);
        })
        .catch(error => {
            hideLoading();
            let errorMessage = 'Failed to delete account.';

            if (error.code === 'auth/wrong-password') {
                errorMessage = 'Incorrect password. Please try again.';
            } else if (error.code === 'auth/user-mismatch') {
                errorMessage = 'User mismatch error. Please log out and try again.';
            } else if (error.code === 'auth/user-not-found') {
                errorMessage = 'User not found. Please log out and try again.';
            } else if (error.code === 'auth/invalid-credential') {
                errorMessage = 'Invalid password. Please try again.';
            } else if (error.code === 'auth/operation-not-allowed') {
                errorMessage = 'Account deletion is not allowed at this time.';
            }

            const errorEl = document.getElementById('deletePasswordError');
            if (errorEl) {
                errorEl.textContent = errorMessage;
                errorEl.style.display = 'block';
            }
        });
}
function applyRolePermissions() {
    if (!AppState.currentUser) return;

    const role = AppState.currentUser.role;

    // Check if page is ready - if nav items don't exist yet, skip
    const navItems = document.querySelectorAll('.nav-item');
    if (!navItems || navItems.length === 0) return;

    const permissions = ROLE_PERMISSIONS[role];

    // Reset any inline display/pointer styles previously applied so
    // permissions changes (e.g., switching users) correctly restore UI.
    navItems.forEach(nav => {
        nav.style.display = '';
        nav.style.pointerEvents = '';
    });
    const adminOnlyElements = document.querySelectorAll('.admin-only');
    adminOnlyElements.forEach(element => {
        element.style.display = '';
        element.style.pointerEvents = '';
    });

    // Apply admin-only visibility
    adminOnlyElements.forEach(element => {
        if (role === 'administrator') {
            element.style.display = 'flex';  // Explicitly show for admin
            element.style.pointerEvents = 'auto';  // Ensure clickable
        } else {
            element.style.display = 'none';  // Hide for non-admin
            element.style.pointerEvents = 'none';  // Prevent interaction
        }
    });

    // Hide or show restricted nav pages based on current role
    if (permissions && permissions.restrictedPages) {
        // First ensure all restricted pages are visible by default
        permissions.restrictedPages.forEach(page => {
            const navItem = document.querySelector(`[data-page="${page}"]`);
            if (navItem) navItem.style.display = '';
        });

        // Now hide them if current role restricts them
        if (role !== 'administrator') {
            permissions.restrictedPages.forEach(page => {
                const navItem = document.querySelector(`[data-page="${page}"]`);
                if (navItem) {
                    navItem.style.display = 'none';
                    navItem.style.pointerEvents = 'none';
                }
            });
        }
    }
}

// ==========================================
// DASHBOARD MODULE
// ==========================================
function loadDashboardContent() {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
        <!-- Statistics Cards at Top -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-header">
                    <div class="stat-icon">📋</div>
                    <div class="stat-trend positive">↑ 12%</div>
                </div>
                <div class="stat-label">Active Orders</div>
                <div class="stat-value" id="dashOrderCount">0</div>
                <div class="stat-description">orders added this week</div>
            </div>

            <div class="stat-card">
                <div class="stat-header">
                    <div class="stat-icon">⚙️</div>
                    <div class="stat-trend positive">↑ 8%</div>
                </div>
                <div class="stat-label">In Production</div>
                <div class="stat-value" id="dashProductionCount">0</div>
                <div class="stat-description">92% efficiency this month</div>
            </div>

            <div class="stat-card">
                <div class="stat-header">
                    <div class="stat-icon">📦</div>
                    <div class="stat-trend negative">↓ 2 items</div>
                </div>
                <div class="stat-label">Inventory Items</div>
                <div class="stat-value" id="dashInventoryCount">0</div>
                <div class="stat-description">5 items need restocking</div>
            </div>

            <div class="stat-card">
                <div class="stat-header">
                    <div class="stat-icon">💰</div>
                    <div class="stat-trend negative">↓ 15%</div>
                </div>
                <div class="stat-label">Monthly Revenue</div>
                <div class="stat-value" id="dashRevenueValue">₱0</div>
                <div class="stat-description">85% of monthly target</div>
            </div>
        </div>

        <!-- Dashboard Grid - Charts and Activity -->
        <div class="dashboard-grid">
            <div class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Revenue Overview</h2>
                        <p class="card-subtitle">Monthly performance vs target</p>
                    </div>
                    <div class="chart-selects-group">
                        <select class="chart-period-select" id="periodSelect" onchange="updateRevenueChart()">
                            <option>Last 6 Months</option>
                            <option>Last 12 Months</option>
                            <option>This Year</option>
                        </select>
                        <select class="chart-period-select" id="weekSelect" onchange="updateRevenueChart()">
                            <option value="">Select Week</option>
                            <option value="week1">Week 1</option>
                            <option value="week2">Week 2</option>
                            <option value="week3">Week 3</option>
                            <option value="week4">Week 4</option>
                            <option value="week5">Week 5</option>
                        </select>
                    </div>
                </div>
                <div class="chart-container">
                    <div class="revenue-bars" style="min-height: 300px; display: flex; align-items: center; justify-content: center; color: var(--text-muted);">
                        No data yet
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Recent Activity</h2>
                        <p class="card-subtitle">Latest updates</p>
                    </div>
                </div>
                <ul class="activity-list" style="min-height: 200px; display: flex; align-items: center; justify-content: center; color: var(--text-muted);">
                    <li style="list-style: none;">No recent activity yet</li>
                </ul>
            </div>
        </div>

        <!-- Quick Actions -->
        <section class="quick-actions">
            <div class="actions-header">
                <h2 class="actions-title">Quick Actions</h2>
            </div>
            <div class="actions-grid">
                <a href="#" class="action-card" onclick="event.preventDefault(); navigateTo('orders')">
                    <div class="action-icon">➕</div>
                    <div class="action-title">New Order</div>
                </a>
                <a href="#" class="action-card" onclick="event.preventDefault(); navigateTo('inventory')">
                    <div class="action-icon">📦</div>
                    <div class="action-title">Add Inventory</div>
                </a>
                <a href="#" class="action-card" onclick="event.preventDefault(); navigateTo('production')">
                    <div class="action-icon">⚙️</div>
                    <div class="action-title">Production Batch</div>
                </a>
                <a href="#" class="action-card" onclick="event.preventDefault(); navigateTo('reports')">
                    <div class="action-icon">📊</div>
                    <div class="action-title">View Reports</div>
                </a>
            </div>
        </section>
    `;

    // Wait for DOM to be ready, then update stats and charts
    setTimeout(() => {
        updateDashboardStats();
    }, 50);
}

function updateDashboardStats() {
    const orderCountEl = document.getElementById('dashOrderCount');
    const productionCountEl = document.getElementById('dashProductionCount');
    const inventoryCountEl = document.getElementById('dashInventoryCount');
    const revenueValueEl = document.getElementById('dashRevenueValue');

    // Count only active orders (not completed)
    const activeOrders = AppState.orders.filter(o => o.status !== 'completed').length;
    if (orderCountEl) orderCountEl.textContent = activeOrders;
    if (productionCountEl) productionCountEl.textContent = (AppState.productions || []).filter(p => p.status !== 'completed').length;
    if (inventoryCountEl) inventoryCountEl.textContent = (AppState.inventoryManagementItems || []).length;

    // Calculate total revenue from all orders
    const totalRevenue = (AppState.orders || []).reduce((sum, order) => {
        return sum + (parseFloat(order.totalAmount) || 0);
    }, 0);
    if (revenueValueEl) revenueValueEl.textContent = '₱' + totalRevenue.toLocaleString('en-PH', { maximumFractionDigits: 0 });

    // Update revenue chart
    updateRevenueChart();

    // Update activity feed
    updateActivityFeed();
}

function updateRevenueChart() {
    const weekSelect = document.getElementById('weekSelect');
    const selectedWeek = weekSelect ? weekSelect.value : '';

    const barsContainer = document.querySelector('.revenue-bars');
    if (!barsContainer) return;

    // Check if a week is selected
    if (selectedWeek) {
        updateWeeklyRevenueChart(selectedWeek);
    } else {
        updateMonthlyRevenueChart();
    }
}

function updateMonthlyRevenueChart() {
    // Calculate last 6 months revenue
    const months = [];
    const revenues = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let i = 5; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        months.push(monthNames[date.getMonth()]);

        // Get revenue for this month
        const monthRevenue = (AppState.orders || [])
            .filter(order => {
                if (!order.dateCreated) return false;
                const orderDate = new Date(order.dateCreated);
                return orderDate.getMonth() === date.getMonth() && orderDate.getFullYear() === date.getFullYear();
            })
            .reduce((sum, order) => sum + (parseFloat(order.totalAmount) || 0), 0);

        revenues.push(monthRevenue);
    }

    // Find max revenue to calculate bar heights
    const maxRevenue = Math.max(...revenues);
    const barsContainer = document.querySelector('.revenue-bars');

    if (barsContainer) {
        if (maxRevenue > 0) {
            // Show actual data
            barsContainer.style.display = 'flex';
            barsContainer.style.alignItems = 'flex-end';
            barsContainer.style.height = '500px';
            barsContainer.style.gap = '1rem';
            barsContainer.innerHTML = revenues.map((revenue, idx) => {
                const height = (revenue / maxRevenue) * 100;
                return `
                    <div class="revenue-bar" style="height: ${height}%;">
                        <div class="bar-value">₱${Math.round(revenue / 1000)}K</div>
                        <div class="bar-label">${months[idx]}</div>
                    </div>
                `;
            }).join('');
        } else {
            // No data - show placeholder
            barsContainer.style.display = 'flex';
            barsContainer.style.alignItems = 'center';
            barsContainer.style.justifyContent = 'center';
            barsContainer.style.minHeight = '300px';
            barsContainer.style.color = 'var(--text-muted)';
            barsContainer.innerHTML = 'No revenue data yet';
        }
    }
}

function updateWeeklyRevenueChart(selectedWeek) {
    const weekNumber = parseInt(selectedWeek.replace('week', ''));
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const days = [];
    const revenues = [];

    // Calculate current week start (Monday)
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when day is Sunday
    const weekStart = new Date(today.setDate(diff));

    // Go back to the selected week
    const weeksBack = 5 - weekNumber;
    for (let i = 0; i < weeksBack; i++) {
        weekStart.setDate(weekStart.getDate() - 7);
    }

    // Get revenue for each day of the week
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        days.push(dayNames[i]);

        const dayRevenue = (AppState.orders || [])
            .filter(order => {
                if (!order.dateCreated) return false;
                const orderDate = new Date(order.dateCreated);
                return orderDate.toDateString() === date.toDateString();
            })
            .reduce((sum, order) => sum + (parseFloat(order.totalAmount) || 0), 0);

        revenues.push(dayRevenue);
    }

    // Find max revenue to calculate bar heights
    const maxRevenue = Math.max(...revenues);
    const barsContainer = document.querySelector('.revenue-bars');

    if (barsContainer) {
        if (maxRevenue > 0) {
            barsContainer.style.display = 'flex';
            barsContainer.style.alignItems = 'flex-end';
            barsContainer.style.height = '500px';
            barsContainer.style.gap = '1rem';
            barsContainer.innerHTML = revenues.map((revenue, idx) => {
                const height = revenue > 0 ? (revenue / maxRevenue) * 100 : 0;
                return `
                    <div class="revenue-bar" style="height: ${height}%;">
                        ${revenue > 0 ? `<div class="bar-value">₱${Math.round(revenue / 1000)}K</div>` : ''}
                        <div class="bar-label">${days[idx]}</div>
                    </div>
                `;
            }).join('');
        } else {
            barsContainer.style.display = 'flex';
            barsContainer.style.alignItems = 'center';
            barsContainer.style.justifyContent = 'center';
            barsContainer.style.minHeight = '300px';
            barsContainer.style.color = 'var(--text-muted)';
            barsContainer.innerHTML = 'No revenue data for this week';
        }
    }
}

function updateActivityFeed() {
    const activities = [];

    // Collect recent orders
    (AppState.orders || []).forEach(order => {
        if (order.dateCreated) {
            activities.push({
                type: 'order',
                icon: '📋',
                title: 'New Order Received',
                description: `Order #${order.orderId} from ${order.customerName || 'Customer'}`,
                date: new Date(order.dateCreated)
            });
        }
    });

    // Collect recent productions
    (AppState.productions || []).forEach(prod => {
        if (prod.dateCreated) {
            activities.push({
                type: 'production',
                icon: '⚙️',
                title: 'Production Batch Created',
                description: `Batch #${prod.batchId}`,
                date: new Date(prod.dateCreated)
            });
        }
    });

    // Collect recent inventory
    (AppState.inventoryManagementItems || []).forEach(item => {
        if (item.dateCreated) {
            activities.push({
                type: 'inventory',
                icon: '📦',
                title: 'Inventory Item Added',
                description: `${item.itemName || 'Item'} (${item.quantity || 0} units)`,
                date: new Date(item.dateCreated)
            });
        }
    });

    // Sort by date (newest first) and limit to 4
    activities.sort((a, b) => b.date - a.date);
    const recentActivities = activities.slice(0, 4);

    const activityList = document.querySelector('.activity-list');
    if (activityList) {
        if (recentActivities.length > 0) {
            activityList.innerHTML = recentActivities.map(activity => {
                const now = new Date();
                const diff = now - activity.date;
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                let timeAgo = 'just now';
                if (minutes > 0) timeAgo = `${minutes}m ago`;
                if (hours > 0) timeAgo = `${hours}h ago`;

                return `
                    <li class="activity-item">
                        <div class="activity-icon ${activity.type}">${activity.icon}</div>
                        <div class="activity-content">
                            <div class="activity-title">${activity.title}</div>
                            <div class="activity-description">${activity.description}</div>
                        </div>
                        <div class="activity-time">${timeAgo}</div>
                    </li>
                `;
            }).join('');
        } else {
            activityList.innerHTML = '<li style="list-style: none; width: 100%; text-align: center; padding: 2rem; color: var(--text-muted);">No recent activity yet</li>';
        }
    }
}

// Clear all system data
// Admin utilities removed: clear-all-data function removed for safety.

// ==========================================
// ORDER & JOB TRACKING MODULE
// ==========================================
function loadOrdersContent() {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
        <div class="orders-page">
            <!-- Stats Cards -->
            <div class="page-stats-grid">
                <div class="page-stat-card" onclick="switchOrderTab('orders')">
                    <div class="page-stat-header">
                        <div class="page-stat-icon">📋</div>
                        <div class="page-stat-title">Active Orders</div>
                        <div class="page-stat-badge">${AppState.orders.filter(o => o.status !== 'completed').length}</div>
                    </div>
                </div>
                <div class="page-stat-card" onclick="switchOrderTab('jobs')">
                    <div class="page-stat-header">
                        <div class="page-stat-icon">⚙️</div>
                        <div class="page-stat-title">Production Jobs</div>
                        <div class="page-stat-badge">${AppState.jobOrders.filter(j => { const order = AppState.orders.find(o => o.orderId === j.orderRef); return order && order.status !== 'completed'; }).length}</div>
                    </div>
                </div>
                <div class="page-stat-card" onclick="switchOrderTab('inventory')">
                    <div class="page-stat-header">
                        <div class="page-stat-icon">📦</div>
                        <div class="page-stat-title">Inventory Catalog</div>
                        <div class="page-stat-badge">${(AppState.inventoryCatalogItems || []).length}</div>
                    </div>
                </div>
            </div>

            <!-- Orders Tab -->
            <div id="ordersTab" class="page-section active">
                <div class="page-section-header">
                    <h2>Order Management</h2>
                    <p>Track and manage all quotations and orders</p>
                </div>

                <div class="page-table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Order ID</th>
                                <th>Customer</th>
                                <th>Garment Type</th>
                                <th>Order Type</th>
                                <th>Qty</th>
                                <th>Delivery Date</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="ordersTableBody">
                            <tr>
                                <td colspan="8">
                                    <div class="page-empty-state">
                                        <div class="page-empty-state-icon">📋</div>
                                        <h3>No Active Orders Found</h3>
                                        <p>Get started by creating your first order or quotation</p>
                                        <button class="page-empty-state-btn" onclick="navigateTo('orders')">
                                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                            </svg>
                                            Create New Order
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Jobs Tab -->
            <div id="jobsTab" class="page-section" style="display: none;">
                <div class="page-section-header">
                    <h2>Production Jobs</h2>
                    <p>Monitor production progress and job assignments</p>
                </div>

                <div class="page-table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Job ID</th>
                                <th>Order Ref</th>
                                <th>Stage</th>
                                <th>Assigned To</th>
                                <th>Progress</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="jobsTableBody">
                            <tr>
                                <td colspan="7">
                                    <div class="page-empty-state">
                                        <div class="page-empty-state-icon">⚙️</div>
                                        <h3>No Production Jobs Found</h3>
                                        <p>Production jobs will appear here</p>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Inventory Tab (Catalog / Grid view) -->
            <div id="inventoryTab" class="page-section" style="display: none;">
                <!-- Inventory Stats Cards -->
                <div class="page-stats-grid" style="margin-bottom: 2.5rem;">
                    <div class="page-stat-card">
                        <div class="page-stat-icon-box">📦</div>
                        <div class="page-stat-info">
                            <div class="page-stat-label">Total Items</div>
                            <div class="page-stat-count" id="invTotalCount">0</div>
                        </div>
                    </div>
                    <div class="page-stat-card">
                        <div class="page-stat-icon-box">✅</div>
                        <div class="page-stat-info">
                            <div class="page-stat-label">Finished</div>
                            <div class="page-stat-count" id="invFinishedCount">0</div>
                        </div>
                    </div>
                    <div class="page-stat-card">
                        <div class="page-stat-icon-box">🧵</div>
                        <div class="page-stat-info">
                            <div class="page-stat-label">Leftover</div>
                            <div class="page-stat-count" id="invLeftoverCount">0</div>
                        </div>
                    </div>
                </div>

                <!-- Filter Tabs (4-column grid layout) -->
                <div class="page-tabs" style="display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 1.5rem; margin-bottom: 2rem; padding: 1.5rem; background: white; border-radius: 14px; box-shadow: 0 4px 12px rgba(44, 54, 57, 0.08);">
                    <button class="tab-btn active" data-tab="finished" onclick="switchCatalogTab('finished', this); renderOrderCatalog({ section: 'finished' })" style="padding: 1.5rem; text-align: center; border: none; background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3);">
                        <div style="font-size: 1.75rem; margin-bottom: 0.5rem;">📦</div>
                        <div>Finished Items</div>
                    </button>
                    <button class="tab-btn" data-tab="leftover" onclick="switchCatalogTab('leftover', this); renderOrderCatalog({ section: 'leftover' })" style="padding: 1.5rem; text-align: center; border: none; background: #F0EBE3; color: var(--charcoal); border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s;">
                        <div style="font-size: 1.75rem; margin-bottom: 0.5rem;">🧵</div>
                        <div>Leftover Items</div>
                    </button>
                </div>

                <!-- Search & Filter -->
                <div style="margin-bottom: 2rem; display: flex; gap: 1rem; align-items: center;">
                    <input id="catalogSearch" type="text" placeholder="Search items by name or SKU..." oninput="renderOrderCatalog({ search: this.value })" style="flex: 1; padding: 0.75rem 1rem; border: 2px solid #F0EBE3; border-radius: 10px; font-size: 0.95rem; font-family: 'DM Sans', sans-serif; transition: all 0.3s;" onfocus="this.style.borderColor='#D4AF37'" onblur="this.style.borderColor='#F0EBE3'" />
                </div>

                <!-- Catalog Grids -->
                <div class="catalog-sections">
                    <div id="finishedGrid" class="catalog-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.5rem;"></div>
                    <div id="leftoverGrid" class="catalog-grid" style="display: none; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.5rem;"></div>
                </div>
            </div>
        </div>
    `;

    // Render initial content
    renderOrdersTable();
    renderJobsTable();
    // Populate inventory catalog and filters
    populateCatalogFilters();
    renderOrderCatalog();
}

// Helpers for catalog-style orders page
function switchCatalogTab(tab, el) {
    // Update button styles
    document.querySelectorAll('.page-tabs .tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tab) {
            btn.style.background = 'linear-gradient(135deg, #D4AF37, #B8941E)';
            btn.style.color = 'white';
            btn.style.boxShadow = '0 4px 12px rgba(212, 175, 55, 0.3)';
        } else {
            btn.style.background = '#F0EBE3';
            btn.style.color = 'var(--charcoal)';
            btn.style.boxShadow = 'none';
        }
    });

    const finishedGrid = document.getElementById('finishedGrid');
    const leftoverGrid = document.getElementById('leftoverGrid');

    if (tab === 'finished') {
        if (finishedGrid) {
            finishedGrid.style.display = 'grid';
            finishedGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
            finishedGrid.style.gap = '1.5rem';
        }
        if (leftoverGrid) leftoverGrid.style.display = 'none';
    } else {
        if (finishedGrid) finishedGrid.style.display = 'none';
        if (leftoverGrid) {
            leftoverGrid.style.display = 'grid';
            leftoverGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
            leftoverGrid.style.gap = '1.5rem';
        }
    }
}

function populateCatalogFilters() {
    // populate garment type filters based on inventory categories
    const types = new Set((AppState.inventoryCatalogItems || []).map(i => i.category).filter(Boolean));
    ['finishedTypeFilter', 'leftoverTypeFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '<option value="">All Types</option>' + Array.from(types).map(t => `<option value="${t}">${t}</option>`).join('');
    });
}

function filterOrderCatalog(section) {
    const type = document.getElementById(section + 'TypeFilter')?.value || '';
    const size = document.getElementById(section + 'SizeFilter')?.value || '';
    const search = document.getElementById(section + 'Search')?.value.toLowerCase() || '';

    renderOrderCatalog({ section, type, size, search });
}

function renderOrderCatalog(opts = {}) {
    const { section = 'finished', type = '', size = '', search = '' } = opts;
    const finishedGrid = document.getElementById('finishedGrid');
    const leftoverGrid = document.getElementById('leftoverGrid');

    const items = AppState.inventoryCatalogItems || [];

    // For demo: treat all items as finished unless category === 'Leftover'
    let finishedItems = items.filter(i => (i.category || '').toLowerCase() !== 'leftover');
    let leftoverItems = items.filter(i => (i.category || '').toLowerCase() === 'leftover');

    // Apply search filter if provided
    if (search) {
        const searchLower = search.toLowerCase();
        finishedItems = finishedItems.filter(i =>
            (i.name || '').toLowerCase().includes(searchLower) ||
            (i.sku || '').toLowerCase().includes(searchLower) ||
            (i.category || '').toLowerCase().includes(searchLower)
        );
        leftoverItems = leftoverItems.filter(i =>
            (i.name || '').toLowerCase().includes(searchLower) ||
            (i.sku || '').toLowerCase().includes(searchLower) ||
            (i.category || '').toLowerCase().includes(searchLower)
        );
    }

    function toCards(list) {
        if (!list || list.length === 0) return `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">📦</div><h3 class="empty-state-title">No Items Found</h3><p class="empty-state-text">No garments match your filters</p></div>`;
        return list.map(item => `
            <div class="product-card" onclick="viewCatalogItem('${item.sku || ''}')">
                <div class="product-image">${item.image ? `<img src="${item.image}" style="max-width:100%;max-height:100%;object-fit:cover;display:block;">` : '<span>📦</span>'}${!item.quantity ? `<div class="product-badge leftover">-${item.discount || 0}%</div>` : ''}</div>
                <div class="product-info">
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <div class="product-name">${item.name || item.sku || 'Item'}</div>
                        ${item.source === 'production' ? `<div class="product-produced-badge">Produced</div>` : ''}
                    </div>
                    <div class="product-code">${item.sku || ''}</div>
                    <div class="product-details">
                        <div class="product-detail"><span class="product-detail-label">Unit:</span><span class="product-detail-value">${item.unit || ''}</span></div>
                        <div class="product-detail"><span class="product-detail-label">Quantity:</span><span class="product-detail-value">${item.quantity || 0} pcs</span></div>
                        ${item.orderCustomer ? `<div class="product-detail"><span class="product-detail-label">Customer:</span><span class="product-detail-value">${item.orderCustomer}</span></div>` : ''}
                    </div>
                    <div class="product-price">₱${(item.unitPrice || 0).toFixed(2)}</div>
                    <div class="product-actions">${item.source !== 'production' ? `<button class="btn btn-primary" onclick="event.stopPropagation(); showMessage('Order', 'Creating order for: ' + ('${item.sku || item.name}'), 'info');">Order</button>` : ''}<button class="btn btn-secondary" onclick="event.stopPropagation(); viewCatalogItem('${item.sku || ''}')">Details</button></div>
                    <div style="margin-top:0.5rem;">
                        <button class="btn btn-danger" style="width:100%;font-size:0.75rem;padding:0.4rem;" onclick="event.stopPropagation(); deleteCatalogItemConfirm('${item.sku || ''}')">🗑️ Delete</button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    if (finishedGrid) finishedGrid.innerHTML = toCards(finishedItems);
    if (leftoverGrid) leftoverGrid.innerHTML = toCards(leftoverItems);

    updateOrderStats();
    updateInventoryStats();
}

function updateOrderStats() {
    const items = AppState.inventoryCatalogItems || [];
    const finished = items.filter(i => (i.category || '').toLowerCase() !== 'leftover');
    const leftover = items.filter(i => (i.category || '').toLowerCase() === 'leftover');

    const finishedCountEl = document.getElementById('finishedCount');
    const finishedValueEl = document.getElementById('finishedValue');
    const finishedTypesEl = document.getElementById('finishedTypes');
    const leftoverCountEl = document.getElementById('leftoverCount');
    const leftoverValueEl = document.getElementById('leftoverValue');
    const leftoverDiscountEl = document.getElementById('leftoverDiscount');

    if (finishedCountEl) finishedCountEl.textContent = finished.reduce((s, i) => s + (i.quantity || 0), 0);
    if (finishedValueEl) finishedValueEl.textContent = '₱' + finished.reduce((s, i) => s + ((i.unitPrice || 0) * (i.quantity || 0)), 0).toFixed(2);
    if (finishedTypesEl) finishedTypesEl.textContent = new Set(finished.map(i => i.category)).size || 0;

    if (leftoverCountEl) leftoverCountEl.textContent = leftover.reduce((s, i) => s + (i.quantity || 0), 0);
    if (leftoverValueEl) leftoverValueEl.textContent = '₱' + leftover.reduce((s, i) => s + ((i.unitPrice || 0) * (i.quantity || 0)), 0).toFixed(2);
    const avgDiscount = leftover.length ? Math.round(leftover.reduce((s, i) => s + (i.discount || 0), 0) / leftover.length) : 0;
    if (leftoverDiscountEl) leftoverDiscountEl.textContent = avgDiscount + '%';
}

function updateInventoryStats() {
    const items = AppState.inventoryCatalogItems || [];
    const finished = items.filter(i => (i.category || '').toLowerCase() !== 'leftover');
    const leftover = items.filter(i => (i.category || '').toLowerCase() === 'leftover');

    const totalCountEl = document.getElementById('invTotalCount');
    const finishedCountEl = document.getElementById('invFinishedCount');
    const leftoverCountEl = document.getElementById('invLeftoverCount');

    if (totalCountEl) totalCountEl.textContent = items.length;
    if (finishedCountEl) finishedCountEl.textContent = finished.length;
    if (leftoverCountEl) leftoverCountEl.textContent = leftover.length;
}

function switchOrderTab(tabName) {
    // Deactivate all stat cards
    document.querySelectorAll('.page-stat-card').forEach(card => {
        card.style.borderTopColor = 'transparent';
        card.style.background = '';
    });

    // Deactivate all sections
    document.querySelectorAll('.page-section').forEach(section => {
        section.classList.remove('active');
        section.style.display = 'none';
    });

    // Activate selected stat card
    const statCard = document.querySelector(`.page-stat-card[onclick*="'${tabName}'"]`);
    if (statCard) {
        statCard.style.borderTopColor = 'var(--gold-primary)';
        statCard.style.background = 'linear-gradient(to right, rgba(212, 175, 55, 0.05), transparent)';
    }

    // Activate selected section
    const section = document.getElementById(tabName + 'Tab');
    if (section) {
        section.classList.add('active');
        section.style.display = 'block';
    }

    // Render specific content
    if (tabName === 'orders') renderOrdersTable();
    if (tabName === 'jobs') renderJobsTable();
    if (tabName === 'inventory') renderOrderCatalog();
}

function renderOrdersTable() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    // Filter out completed orders
    const activeOrders = AppState.orders.filter(o => o.status !== 'completed');

    if (activeOrders.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="8">No active orders found. Click "New Order" to create one.</td></tr>';
        return;
    }

    tbody.innerHTML = activeOrders.map(order => `
        <tr>
            <td>${order.orderId}</td>
            <td>${order.customerName}</td>
            <td>${order.garmentType}</td>
            <td>${(order.orderType || '').toString().toUpperCase() || '-'}</td>
            <td>${order.quantity}</td>
            <td>${order.deliveryDate}</td>
            <td><span class="status-badge status-${normalizeStatusForClass(order.status)}">${formatStatus(order.status)}</span></td>
            <td>
                <button class="action-btn action-btn-view" onclick="viewOrder('${order.orderId}')">View</button>
                <button class="action-btn action-btn-delete" onclick="confirmDeleteOrder('${order.orderId}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

function renderJobsTable() {
    const tbody = document.getElementById('jobsTableBody');
    if (!tbody) return;

    // Filter jobs for non-completed orders
    const activeJobs = AppState.jobOrders.filter(job => {
        const order = AppState.orders.find(o => o.orderId === job.orderRef);
        return order && order.status !== 'completed';
    });

    if (activeJobs.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No active job orders found.</td></tr>';
        return;
    }

    tbody.innerHTML = activeJobs.map(job => `
        <tr>
            <td>${job.jobId}</td>
            <td>${job.orderRef}</td>
            <td>${job.stage}</td>
            <td>${job.assignedTo}</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-fill"><div style="width: ${job.progress}%;"></div></div>
                    <span class="progress-text">${job.progress}%</span>
                </div>
            </td>
            <td><span class="status-badge status-${normalizeStatusForClass(job.status)}">${formatStatus(job.status)}</span></td>
            <td>
                <button class="action-btn action-btn-view" onclick="viewJob('${job.jobId}')">View</button>
                <button class="action-btn action-btn-delete" onclick="confirmDeleteJob('${job.jobId}')" style="margin-left: 0.25rem;">Delete</button>
            </td>
        </tr>
    `).join('');
}

function renderInventoryTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    const items = AppState.inventoryCatalogItems || [];
    if (items.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No inventory items found.</td></tr>';
        return;
    }

    tbody.innerHTML = items.map(item => `
        <tr>
            <td>${item.sku || item.itemId || '-'}</td>
            <td>${item.name || '-'}</td>
            <td>${item.category || item.type || '-'}</td>
            <td>${item.quantity || 0}</td>
            <td>₱${(item.unitPrice || 0).toFixed(2)}</td>
            <td>₱${(((item.unitPrice || 0) * (item.quantity || 0)) || 0).toFixed(2)}</td>
            <td>
                <button class="action-btn action-btn-view" onclick="viewCatalogItem('${item.sku || item.itemId || ''}')">View</button>
                <button class="action-btn action-btn-delete" onclick="deleteCatalogItemConfirm('${item.sku || item.itemId || ''}')" style="margin-left: 0.25rem;">Delete</button>
            </td>
        </tr>
    `).join('');
}

function viewOrder(orderId) {
    const order = AppState.orders.find(o => o.orderId === orderId);
    if (!order) {
        showMessage('Order Not Found', 'This order could not be found.', 'error');
        return;
    }

    // Handle sizes - can be array of objects or object
    let sizeDetails = 'N/A';
    if (order.sizes) {
        if (Array.isArray(order.sizes) && order.sizes.length > 0) {
            sizeDetails = order.sizes.map(s => `${s.size || s}: ${s.quantity || 0} units`).join(', ');
        } else if (typeof order.sizes === 'object' && Object.keys(order.sizes).length > 0) {
            sizeDetails = Object.entries(order.sizes).map(([size, qty]) => `${size}: ${qty} units`).join(', ');
        }
    }

    const quoteTotal = (typeof order.quotedAmount === 'number') ? order.quotedAmount : 0;
    const orderStatus = order.status || 'unknown';

    // Prefer order.deliveryAddress, fallback to any delivery record for this order
    const relatedDelivery = (AppState.deliveries || []).find(d => d.orderRef === order.orderId) || (AppState.deliveries || []).find(d => {
        const inv = (AppState.billings || []).find(b => b.invoiceId === d.invoiceRef);
        return inv && inv.orderRef === order.orderId;
    });
    const displayedDeliveryAddress = order.deliveryAddress || (relatedDelivery && relatedDelivery.deliveryAddress) || '-';

    // Build color HTML with swatches
    let colorHTML = '<p style="margin: 0.5rem 0; font-size: 1rem; color: #999;">N/A</p>';
    if (order.color) {
        colorHTML = `<p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${order.color}</p>`;
    } else if (Array.isArray(order.colors) && order.colors.length) {
        // Colors is array of objects with {name, hex, quantity} or just strings
        const colorItems = order.colors.map(c => {
            if (typeof c === 'object') {
                const name = c.name || c.label || 'Unnamed';
                const hex = c.hex || '#CCCCCC';
                return `<div style="display: flex; align-items: center; gap: 0.75rem; margin: 0.5rem 0;">
                    <div style="width: 24px; height: 24px; background: ${hex}; border: 1px solid #ccc; border-radius: 4px;"></div>
                    <span style="font-size: 0.95rem;">${name}</span>
                </div>`;
            } else {
                return `<p style="margin: 0.5rem 0; font-size: 0.95rem;">${c}</p>`;
            }
        }).join('');
        colorHTML = colorItems;
    } else if (typeof order.colors === 'string') {
        colorHTML = `<p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${order.colors}</p>`;
    } else if (order.selectedColor) {
        colorHTML = `<p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${order.selectedColor}</p>`;
    }

    const modal = createModal(`View Order - ${orderId}`, `
        <div style="padding: 1.5rem; max-height: 500px; overflow-y: auto;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Customer Name</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${order.customerName}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Status</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600; color: ${orderStatus === 'approved' ? '#27AE60' : '#F39C12'};">${orderStatus}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Email</p>
                    <p style="margin: 0.5rem 0; font-size: 0.9rem;">${order.customerEmail}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Phone</p>
                    <p style="margin: 0.5rem 0; font-size: 0.9rem;">${order.customerPhone}</p>
                </div>
                <div style="grid-column: 1 / -1;">
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Delivery Address</p>
                    <p style="margin: 0.5rem 0; font-size: 0.9rem;">${displayedDeliveryAddress}</p>
                </div>
            </div>
            <hr style="margin: 1rem 0; border: none; border-top: 1px solid #ddd;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Garment Type</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${order.garmentType || 'N/A'}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Color</p>
                    ${colorHTML}
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Quantity</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${order.quantity || 0} pieces</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Sizes</p>
                    <p style="margin: 0.5rem 0; font-size: 0.9rem;">${sizeDetails}</p>
                </div>
                <div style="grid-column: 1 / -1;">
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Special Instructions</p>
            <hr style="margin: 1rem 0; border: none; border-top: 1px solid #ddd;">
            <div style="margin-bottom: 1.5rem;">
                <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Design Files</p>
                ${(() => {
            const files = order.files || [];
            if (files.length === 0) {
                return '<p style="margin: 0.5rem 0; color: #999; font-style: italic;">No design files uploaded</p>';
            }
            return '<div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.75rem;">' +
                files.map(f => {
                    const isImage = /image\/(png|jpg|jpeg|gif|webp)/i.test(f.type);
                    if (isImage) {
                        return `<div style="border: 1px solid #ddd; border-radius: 4px; overflow: hidden;"><img src="${f.data}" style="max-width: 100%; max-height: 150px; display: block;"></div>`;
                    } else {
                        return `<div style="padding: 0.75rem; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; color: #666; font-size: 0.9rem;">📄 ${f.name}</div>`;
                    }
                }).join('') +
                '</div>';
        })()}
            </div>
            <div style="margin-bottom:1rem;">
                <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Receipts</p>
                ${(() => {
            const recs = (AppState.billings || []).filter(b => b.type === 'production_receipt' && b.orderRef === order.orderId);
            if (!recs || recs.length === 0) return '<p style="margin:0.5rem 0;color:#999;">No receipts for this order</p>';
            return '<div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.5rem;">' + recs.map(r => `
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
                            <div><strong>${r.receiptId}</strong> &nbsp; <span style="color:#666">${r.date}</span></div>
                            <div><button class="action-btn action-btn-view" onclick="viewReceipt('${r.receiptId}')">View</button><button class="action-btn action-btn-edit" onclick="printStoredReceipt('${r.receiptId}')" style="margin-left:6px;">Print</button></div>
                        </div>`).join('') + '</div>';
        })()}
            </div>
            <hr style="margin: 1rem 0; border: none; border-top: 1px solid #ddd;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Order Created</p>
                    <p style="margin: 0.5rem 0; font-size: 0.9rem;">${order.createdDate || '-'}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Deadline</p>
                    <p style="margin: 0.5rem 0; font-size: 0.9rem;">${order.deadline}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Quotation Total</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600; color: #D4AF37;">₱${quoteTotal.toLocaleString()}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Delivery Date</p>
                    <p style="margin: 0.5rem 0; font-size: 0.9rem;">${order.deliveryDate || 'TBD'}</p>
                </div>
            </div>
            <div style="margin-top: 1.5rem; text-align: center;">
                <button class="btn-primary" onclick="closeModal()" style="padding: 0.75rem 2rem;">Close</button>
            </div>
        </div>
    `);

    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function editOrder(orderId) {
    const order = AppState.orders.find(o => o.orderId === orderId);
    if (!order) {
        showMessage('Order Not Found', 'This order could not be found.', 'error');
        return;
    }

    const modal = createModal(`Edit Order - ${orderId}`, `
        <div style="padding: 1.5rem; max-height: 600px; overflow-y: auto;">
            <form onsubmit="saveOrderChanges(event, '${orderId}')">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; color: #666; font-size: 0.9rem;">Customer Name</label>
                        <input type="text" name="customerName" value="${order.customerName}" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; color: #666; font-size: 0.9rem;">Status</label>
                        <select name="status" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;">
                            <option value="${order.status}" selected>${formatStatus(order.status)}</option>
                            ${order.status !== 'pending' ? '<option value="pending">Pending</option>' : ''}
                            ${order.status !== 'approved' ? '<option value="approved">Approved</option>' : ''}
                            ${order.status !== 'in_production' ? '<option value="in_production">In_Production</option>' : ''}
                            ${order.status !== 'completed' ? '<option value="completed">Completed</option>' : ''}
                        </select>
                    </div>
                </div>
                <div style="margin-top: 1.5rem; text-align: center;">
                    <button type="submit" class="btn-primary" style="padding: 0.75rem 2rem; margin-right: 0.5rem;">Save Changes</button>
                    <button type="button" class="btn-secondary" onclick="closeModal()" style="padding: 0.75rem 2rem; background: #95a5a6;">Cancel</button>
                </div>
            </form>
        </div>
    `);

    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function saveOrderChanges(e, orderId) {
    e.preventDefault();
    showLoading('Saving order changes...');
    const order = AppState.orders.find(o => o.orderId === orderId);
    if (order) {
        try {
            // Read updated values from the form instead of relying on inline handlers
            const form = e.target;
            const customerNameField = form.querySelector('[name="customerName"]');
            const statusField = form.querySelector('[name="status"]');
            if (customerNameField) order.customerName = customerNameField.value;
            if (statusField) order.status = statusField.value;

            await syncDataToFirestore();
            hideLoading();
            showMessage('Success', 'Order updated successfully!', 'success');
            setTimeout(() => closeModal(), 1000);
            loadOrdersContent();
        } catch (err) {
            hideLoading();
            console.error('Failed to save order changes:', err);
            showMessage('Error', 'Failed to save order: ' + err.message, 'error');
        }
    } else {
        hideLoading();
        showMessage('Error', 'Order not found', 'error');
    }
}

function confirmDeleteOrder(orderId) {
    const order = AppState.orders.find(o => o.orderId === orderId);
    if (!order) return;

    const modal = createModal('Delete Order', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #e74c3c;">⚠️ Delete Order?</p>
            <p style="margin-bottom: 0.5rem; color: #333;">Order ID: <strong>${orderId}</strong></p>
            <p style="margin-bottom: 0.5rem; color: #333;">Customer: <strong>${order.customerName}</strong></p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">This action cannot be undone.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="deleteOrderConfirmed('${orderId}')" style="padding: 0.75rem 1.5rem; background: #e74c3c;">Delete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function deleteOrderConfirmed(orderId) {
    showLoading('Deleting order...');
    try {
        const index = AppState.orders.findIndex(o => o.orderId === orderId);
        if (index !== -1) {
            // Delete the order
            AppState.orders.splice(index, 1);

            // Also delete related job orders
            AppState.jobOrders = AppState.jobOrders.filter(j => j.orderRef !== orderId);

            await syncDataToFirestore();
            hideLoading();
            closeModal();
            renderOrdersTable();
            renderJobsTable();
            updateDashboardStats();
            showMessage('Success', 'Order and related jobs deleted successfully', 'success');
        } else {
            hideLoading();
            showMessage('Error', 'Order not found', 'error');
        }
    } catch (error) {
        hideLoading();
        showMessage('Error', 'Failed to delete order: ' + error.message, 'error');
    }
}

function viewJob(jobId) {
    const job = AppState.jobOrders.find(j => j.jobId === jobId);
    if (!job) {
        showMessage('Job Not Found', 'This job could not be found.', 'error');
        return;
    }

    // Build job color HTML with swatches
    let jobColorHTML = '<p style="margin: 0.5rem 0; font-size: 1rem; color: #999;">N/A</p>';
    if (job.color) {
        jobColorHTML = `<p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${job.color}</p>`;
    } else if (Array.isArray(job.colors) && job.colors.length) {
        // Colors is array of objects with {name, hex, quantity} or just strings
        const colorItems = job.colors.map(c => {
            if (typeof c === 'object') {
                const name = c.name || c.label || 'Unnamed';
                const hex = c.hex || '#CCCCCC';
                return `<div style="display: flex; align-items: center; gap: 0.75rem; margin: 0.5rem 0;">
                    <div style="width: 24px; height: 24px; background: ${hex}; border: 1px solid #ccc; border-radius: 4px;"></div>
                    <span style="font-size: 0.95rem;">${name}</span>
                </div>`;
            } else {
                return `<p style="margin: 0.5rem 0; font-size: 0.95rem;">${c}</p>`;
            }
        }).join('');
        jobColorHTML = colorItems;
    } else if (typeof job.colors === 'string') {
        jobColorHTML = `<p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${job.colors}</p>`;
    }

    const modal = createModal(`View Job - ${jobId}`, `
        <div style="padding: 1.5rem; max-height: 500px; overflow-y: auto;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Order Reference</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${job.orderRef}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Status</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600; color: #F39C12;">${job.status}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Garment Type</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${job.garmentType}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Quantity</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${job.quantity} pieces</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Color</p>
                    ${jobColorHTML}
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Stage</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${job.stage}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Assigned To</p>
                    <p style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600;">${job.assignedTo}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Progress</p>
                    <div style="width: 100%; height: 6px; background: #ecf0f1; border-radius: 3px; overflow: hidden;">
                        <div style="width: ${job.progress}%; height: 100%; background: #D4AF37;"></div>
                    </div>
                    <p style="margin: 0.3rem 0; font-size: 0.85rem; color: #666;">${job.progress}%</p>
                </div>
            </div>
            <hr style="margin: 1rem 0; border: none; border-top: 1px solid #ddd;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Created Date</p>
                    <p style="margin: 0.5rem 0; font-size: 0.9rem;">${job.createdDate}</p>
                </div>
                <div>
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Due Date</p>
                    <p style="margin: 0.5rem 0; font-size: 0.9rem;">${job.dueDate}</p>
                </div>
                <div style="grid-column: 1 / -1;">
                    <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">Notes</p>
                    <p style="margin: 0.5rem 0; font-size: 0.9rem;">${job.notes || 'None'}</p>
                </div>
            </div>
            <div style="margin-top: 1.5rem; text-align: center;">
                <button class="btn-primary" onclick="closeModal()" style="padding: 0.75rem 2rem;">Close</button>
            </div>
        </div>
    `);

    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function confirmDeleteJob(jobId) {
    const job = AppState.jobOrders.find(j => j.jobId === jobId);
    if (!job) return;

    const modal = createModal('Delete Production Job', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Delete production job <strong>${jobId}</strong>?</p>
            <p style="margin-bottom: 0.5rem; color: #666; font-size: 0.9rem;">Order Reference: <strong>${job.orderRef}</strong></p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">Garment: <strong>${job.garmentType}</strong> (${job.quantity} pcs)</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem;">Cancel</button>
                <button class="btn btn-primary" onclick="deleteJobConfirmed('${jobId}')" style="padding: 0.75rem 1.5rem; background: #E74C3C;">Delete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function deleteJobConfirmed(jobId) {
    showLoading('Deleting job order...');
    try {
        const jobIndex = AppState.jobOrders.findIndex(j => j.jobId === jobId);
        if (jobIndex > -1) {
            AppState.jobOrders.splice(jobIndex, 1);
        }

        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderJobsTable();
        updateDashboardStats();
        showMessage('Success', 'Production job deleted successfully!', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error deleting job:', error);
        showMessage('Error', 'Failed to delete job: ' + error.message, 'error');
    }
}

// ==========================================
// INVENTORY MANAGEMENT MODULE
// ==========================================
function loadInventoryContent() {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
        <div class="orders-page">
            <!-- Stats Cards -->
            <div class="page-stats-grid">
                <div class="page-stat-card">
                    <div class="page-stat-icon-box">📦</div>
                    <div class="page-stat-info">
                        <div class="page-stat-label">Total Items</div>
                        <div class="page-stat-count" id="totalItemsCount">0</div>
                    </div>
                </div>
                <div class="page-stat-card">
                    <div class="page-stat-icon-box">⚠️</div>
                    <div class="page-stat-info">
                        <div class="page-stat-label">Low Stock</div>
                        <div class="page-stat-count" id="lowStockCount">0</div>
                    </div>
                </div>
                <div class="page-stat-card">
                    <div class="page-stat-icon-box">❌</div>
                    <div class="page-stat-info">
                        <div class="page-stat-label">Out of Stock</div>
                        <div class="page-stat-count" id="outOfStockCount">0</div>
                    </div>
                </div>
            </div>

            <!-- Filter Tabs (5 standalone cards) -->
            <div style="display: grid !important; grid-template-columns: repeat(5, 1fr) !important; gap: 1.5rem; margin-bottom: 2rem;">
                <button class="tab-btn active" data-tab="fabrics" onclick="switchInventoryTab('fabrics')" style="padding: 2rem; text-align: center; border: none; background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; border-radius: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3); display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📋</div>
                    <div style="font-size: 1rem; font-weight: 700;">Fabrics</div>
                </button>
                <button class="tab-btn" data-tab="accessories" onclick="switchInventoryTab('accessories')" style="padding: 2rem; text-align: center; border: none; background: #F0EBE3; color: #2C3639; border-radius: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 8px rgba(44, 54, 57, 0.06); display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🔧</div>
                    <div style="font-size: 1rem; font-weight: 700;">Accessories</div>
                </button>
                <button class="tab-btn" data-tab="other" onclick="switchInventoryTab('other')" style="padding: 2rem; text-align: center; border: none; background: #F0EBE3; color: #2C3639; border-radius: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 8px rgba(44, 54, 57, 0.06); display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📦</div>
                    <div style="font-size: 1rem; font-weight: 700;">Other Items</div>
                </button>
                <button class="tab-btn" data-tab="lowstock" onclick="switchInventoryTab('lowstock')" style="padding: 2rem; text-align: center; border: none; background: #F0EBE3; color: #2C3639; border-radius: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 8px rgba(44, 54, 57, 0.06); display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⚠️</div>
                    <div style="font-size: 1rem; font-weight: 700;">Low Stocks</div>
                </button>
                <button class="tab-btn" data-tab="history" onclick="switchInventoryTab('history')" style="padding: 2rem; text-align: center; border: none; background: #F0EBE3; color: #2C3639; border-radius: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 8px rgba(44, 54, 57, 0.06); display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📜</div>
                    <div style="font-size: 1rem; font-weight: 700;">History</div>
                </button>
            </div>

            <!-- Tab Contents -->
            <div style="padding: 0;">
                <!-- Fabrics Tab -->
                <div id="fabricsTab" class="inventory-tab-content" style="display: block; background: white; border-radius: 14px; padding: 2rem; box-shadow: 0 4px 12px rgba(44, 54, 57, 0.08);">
                    <div style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: #2C3639; font-size: 1.25rem;">Fabric Inventory</h3>
                        <button class="btn btn-primary" onclick="openAddInventoryModal('fabric')" style="padding: 0.75rem 1.5rem; background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">+ Add Fabric</button>
                    </div>
                    <div style="margin-bottom: 1.5rem;">
                        <input type="text" id="fabricSearch" style="width: 100%; padding: 0.75rem 1rem; border: 2px solid #F0EBE3; border-radius: 10px; font-size: 0.95rem; font-family: 'DM Sans', sans-serif; transition: all 0.3s;" placeholder="Search fabrics by name or SKU..." onkeyup="filterInventoryTab('fabrics')" onfocus="this.style.borderColor='#D4AF37'" onblur="this.style.borderColor='#F0EBE3'">
                    </div>
                    <div style="overflow-x: auto; border-radius: 10px; border: 1px solid #F0EBE3;">
                        <table class="inventory-table">
                            <thead>
                                <tr>
                                    <th>SKU</th>
                                    <th>Item Name</th>
                                    <th style="text-align: right;">Qty</th>
                                    <th>Unit</th>
                                    <th style="text-align: right;">Unit Price</th>
                                    <th style="text-align: right;">Total Value</th>
                                    <th style="text-align: center;">Status</th>
                                    <th style="text-align: center;">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="fabricsTabBody">
                                <tr>
                                    <td colspan="8" style="padding: 2rem; text-align: center; color: #576F72;">No fabrics found</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Accessories Tab -->
                <div id="accessoriesTab" class="inventory-tab-content" style="display: none; background: white; border-radius: 14px; padding: 2rem; box-shadow: 0 4px 12px rgba(44, 54, 57, 0.08);">
                    <div style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: #2C3639; font-size: 1.25rem;">Accessories & Fasteners</h3>
                        <button class="btn btn-primary" onclick="openAddInventoryModal('accessory')" style="padding: 0.75rem 1.5rem; background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">+ Add Accessory</button>
                    </div>
                    <div style="margin-bottom: 1.5rem;">
                        <input type="text" id="accessorySearch" style="width: 100%; padding: 0.75rem 1rem; border: 2px solid #F0EBE3; border-radius: 10px; font-size: 0.95rem; font-family: 'DM Sans', sans-serif; transition: all 0.3s;" placeholder="Search accessories by name or SKU..." onkeyup="filterInventoryTab('accessories')" onfocus="this.style.borderColor='#D4AF37'" onblur="this.style.borderColor='#F0EBE3'">
                    </div>
                    <div style="overflow-x: auto; border-radius: 10px; border: 1px solid #F0EBE3;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                            <thead style="background: linear-gradient(to right, #faf7f0, #f0ebe3);">
                                <tr>
                                    <th style="padding: 1rem 1.5rem; text-align: left; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">SKU</th>
                                    <th style="padding: 1rem 1.5rem; text-align: left; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Item Name</th>
                                    <th style="padding: 1rem 1.5rem; text-align: right; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Qty</th>
                                    <th style="padding: 1rem 1.5rem; text-align: left; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Category</th>
                                    <th style="padding: 1rem 1.5rem; text-align: right; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Unit Price</th>
                                    <th style="padding: 1rem 1.5rem; text-align: right; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Total Value</th>
                                    <th style="padding: 1rem 1.5rem; text-align: center; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Status</th>
                                    <th style="padding: 1rem 1.5rem; text-align: center; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="accessoriesTabBody"><tr><td colspan="8" style="padding: 2rem; text-align: center; color: #576F72;">No accessories found</td></tr></tbody>
                        </table>
                    </div>
                </div>

                <!-- Other Items Tab -->
                <div id="otherTab" class="inventory-tab-content" style="display: none; background: white; border-radius: 14px; padding: 2rem; box-shadow: 0 4px 12px rgba(44, 54, 57, 0.08);">
                    <div style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: #2C3639; font-size: 1.25rem;">Other Materials</h3>
                        <button class="btn btn-primary" onclick="openAddInventoryModal('other')" style="padding: 0.75rem 1.5rem; background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">+ Add Other</button>
                    </div>
                    <div style="margin-bottom: 1.5rem;">
                        <input type="text" id="otherSearch" style="width: 100%; padding: 0.75rem 1rem; border: 2px solid #F0EBE3; border-radius: 10px; font-size: 0.95rem; font-family: 'DM Sans', sans-serif; transition: all 0.3s;" placeholder="Search materials by name or SKU..." onkeyup="filterInventoryTab('other')" onfocus="this.style.borderColor='#D4AF37'" onblur="this.style.borderColor='#F0EBE3'">
                    </div>
                    <div style="overflow-x: auto; border-radius: 10px; border: 1px solid #F0EBE3;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                            <thead style="background: linear-gradient(to right, #faf7f0, #f0ebe3);">
                                <tr>
                                    <th style="padding: 1rem 1.5rem; text-align: left; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">SKU</th>
                                    <th style="padding: 1rem 1.5rem; text-align: left; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Item Name</th>
                                    <th style="padding: 1rem 1.5rem; text-align: right; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Qty</th>
                                    <th style="padding: 1rem 1.5rem; text-align: left; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Category</th>
                                    <th style="padding: 1rem 1.5rem; text-align: right; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Unit Price</th>
                                    <th style="padding: 1rem 1.5rem; text-align: right; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Total Value</th>
                                    <th style="padding: 1rem 1.5rem; text-align: center; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Status</th>
                                    <th style="padding: 1rem 1.5rem; text-align: center; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="otherTabBody"><tr><td colspan="8" style="padding: 2rem; text-align: center; color: #576F72;">No materials found</td></tr></tbody>
                        </table>
                    </div>
                </div>

                <!-- Low Stock Tab -->
                <div id="lowstockTab" class="inventory-tab-content" style="display: none; background: white; border-radius: 14px; padding: 2rem; box-shadow: 0 4px 12px rgba(44, 54, 57, 0.08);">
                    <h3 style="margin-top: 0; margin-bottom: 0.5rem; color: #2C3639; font-size: 1.25rem;">Low Stock Items</h3>
                    <p style="color: #576F72; margin-bottom: 1.5rem;">Items with quantity below 50% of normal stock level</p>
                    <div style="overflow-x: auto; border-radius: 10px; border: 1px solid #F0EBE3;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                            <thead style="background: linear-gradient(to right, #faf7f0, #f0ebe3);">
                                <tr>
                                    <th style="padding: 1rem 1.5rem; text-align: left; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">SKU</th>
                                    <th style="padding: 1rem 1.5rem; text-align: left; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Item Name</th>
                                    <th style="padding: 1rem 1.5rem; text-align: left; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Category</th>
                                    <th style="padding: 1rem 1.5rem; text-align: right; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Current Qty</th>
                                    <th style="padding: 1rem 1.5rem; text-align: center; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Status</th>
                                    <th style="padding: 1rem 1.5rem; text-align: center; color: #2C3639; border-bottom: 2px solid #D4AF37; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; vertical-align: middle;">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="lowstockTabBody"><tr><td colspan="6" style="padding: 2rem; text-align: center; color: #228B22;">✓ All items in stock</td></tr></tbody>
                        </table>
                    </div>
                </div>

                <!-- Usage History Tab -->
                <div id="historyTab" class="inventory-tab-content" style="display: none; background: white; border-radius: 14px; padding: 2rem; box-shadow: 0 4px 12px rgba(44, 54, 57, 0.08);">
                    <h3 style="margin-top: 0; margin-bottom: 0.5rem; color: #2C3639; font-size: 1.25rem;">Inventory Usage History</h3>
                    <p style="color: #576F72; margin-bottom: 1.5rem;">Records of fabrics and accessories deducted when production batches are created</p>
                    <div style="margin-bottom: 1.5rem;">
                        <input type="text" id="historySearch" style="width: 100%; padding: 0.75rem 1rem; border: 2px solid #F0EBE3; border-radius: 10px; font-size: 0.95rem; font-family: 'DM Sans', sans-serif; transition: all 0.3s;" placeholder="Search by batch, order, customer, or date..." onkeyup="renderHistoryTab()" onfocus="this.style.borderColor='#D4AF37'" onblur="this.style.borderColor='#F0EBE3'">
                    </div>
                    <div id="historyContainer" style="max-height: 600px; overflow-y: auto;">
                        <!-- History items will be rendered here -->
                    </div>
                </div>
            </div>
        </div>
    `;

    renderInventoryTabs();
}

function getStandardPrice(materialName) {
    const priceMap = {
        'Fabric - Cotton': 250,
        'Fabric - Silk': 400,
        'Fabric - Wool': 350,
        'Fabric - Blend': 280,
        'Lining Fabric': 150,
        'Lace Fabric': 320,
        'Interfacing': 120,
        'Thread': 50,
        'Embroidery Thread': 60,
        'Buttons': 25,
        'Zipper': 40,
        'Snaps': 30,
        'Hook & Eye': 35,
        'Rivets': 20,
        'Elastic': 100,
        'Collar Stay': 45,
        'Label/Tag': 15,
        'Bias Tape': 80,
        'Ribbing': 130,
        'Piping': 110,
        'Shoulder Pads': 60,
        'Padding/Filling': 90,
        'Yarn - Acrylic': 85,
        'Yarn - Wool': 150,
        'Embroidery Materials': 40,
        'Screen Print Materials': 70,
        'Beads/Sequins': 55,
        'Rhinestones': 75
    };
    return priceMap[materialName] || 100;
}

function openAddInventoryModal(categoryFilter) {
    // Material types map with their categories and units
    const materialTypes = [
        // Fabric Types
        { name: 'Fabric - Cotton', category: 'Fabric', unit: 'yards' },
        { name: 'Fabric - Silk', category: 'Fabric', unit: 'yards' },
        { name: 'Fabric - Wool', category: 'Fabric', unit: 'yards' },
        { name: 'Fabric - Blend', category: 'Fabric', unit: 'yards' },
        { name: 'Lining Fabric', category: 'Fabric', unit: 'yards' },
        { name: 'Lace Fabric', category: 'Fabric', unit: 'yards' },
        { name: 'Interfacing', category: 'Fabric', unit: 'yards' },

        // Thread & Fasteners
        { name: 'Thread', category: 'Thread', unit: 'pieces' },
        { name: 'Embroidery Thread', category: 'Thread', unit: 'pieces' },
        { name: 'Buttons', category: 'Button', unit: 'pieces' },
        { name: 'Zipper', category: 'Zipper', unit: 'pieces' },
        { name: 'Snaps', category: 'Fastener', unit: 'pieces' },
        { name: 'Hook & Eye', category: 'Fastener', unit: 'pieces' },
        { name: 'Rivets', category: 'Fastener', unit: 'pieces' },

        // Accessories & Trim
        { name: 'Elastic', category: 'Accessory', unit: 'yards' },
        { name: 'Collar Stay', category: 'Accessory', unit: 'pieces' },
        { name: 'Label/Tag', category: 'Accessory', unit: 'pieces' },
        { name: 'Bias Tape', category: 'Accessory', unit: 'yards' },
        { name: 'Ribbing', category: 'Accessory', unit: 'yards' },
        { name: 'Piping', category: 'Accessory', unit: 'yards' },
        { name: 'Shoulder Pads', category: 'Accessory', unit: 'pieces' },
        { name: 'Padding/Filling', category: 'Accessory', unit: 'pieces' },

        // Knit / Sweater supplies
        { name: 'Yarn - Acrylic', category: 'Yarn', unit: 'skeins' },
        { name: 'Yarn - Wool', category: 'Yarn', unit: 'skeins' },

        // Embellishments
        { name: 'Embroidery Materials', category: 'Embellishment', unit: 'pieces' },
        { name: 'Screen Print Materials', category: 'Embellishment', unit: 'pieces' },
        { name: 'Beads/Sequins', category: 'Embellishment', unit: 'pieces' },
        { name: 'Rhinestones', category: 'Embellishment', unit: 'pieces' }
    ];
    // categorize for filtering - accessories should be the obvious accessory/fastener categories;
    // other categories like Thread, Yarn, Embellishment will be treated as 'Other'
    const accessoriesCats = ['Accessory', 'Button', 'Zipper', 'Fastener'];
    let filteredMaterials = materialTypes;
    let modalTitle = 'Add Inventory Item';
    if (categoryFilter === 'fabric') {
        filteredMaterials = materialTypes.filter(m => m.category === 'Fabric');
        modalTitle = 'Add Fabric';
    } else if (categoryFilter === 'accessory') {
        filteredMaterials = materialTypes.filter(m => accessoriesCats.includes(m.category));
        modalTitle = 'Add Accessory';
    } else if (categoryFilter === 'other') {
        filteredMaterials = materialTypes.filter(m => m.category !== 'Fabric' && !accessoriesCats.includes(m.category));
        modalTitle = 'Add Other Item';
    }

    // Always provide a custom option specific to the category so user can enter free-form items
    const customMat = { name: '__CUSTOM__', category: (categoryFilter === 'fabric' ? 'Fabric' : categoryFilter === 'accessory' ? 'Accessory' : 'Other'), unit: (categoryFilter === 'fabric' ? 'yards' : 'pieces') };
    // append as last option
    filteredMaterials = filteredMaterials.concat([customMat]);

    const modal = createModal(modalTitle, `
        <form id="addInventoryForm" class="order-form">
            <div class="form-row">
                <div class="form-group">
                    <label>Material Type *</label>
                    <select id="materialType" required onchange="updateUnitAndQuantityLabel()">
                        <option value="">-- Select Material Type --</option>
                        ${filteredMaterials.map(mat => `<option value='${JSON.stringify(mat)}'>${mat.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                    <div class="form-group">
                        <label>SKU *</label>
                        <input type="text" id="sku" placeholder="e.g., FAB-001" required>
                    </div>
                    <div class="form-group">
                        <label>Item Name *</label>
                        <input type="text" id="itemName" placeholder="e.g., Cotton Fabric - White" required>
                </div>
                <div id="colorContainer" class="form-group">
                    <label>Color (optional)</label>
                    <div style="display:flex;gap:0.5rem;align-items:center;">
                        <select id="colorSelect" onchange="updateColorPreview()" style="flex:1;">
                            <option value="">-- None --</option>
                            <option value="#FFFFFF">White</option>
                            <option value="#000000">Black</option>
                            <option value="#1A1A1A">Charcoal</option>
                            <option value="#2C3E50">Navy</option>
                            <option value="#34495E">Dark Gray</option>
                            <option value="#7F8C8D">Gray</option>
                            <option value="#D3D3D3">Light Gray</option>
                            <option value="#8B7355">Tan/Beige</option>
                            <option value="#DAA520">Khaki</option>
                            <option value="#A0826D">Brown</option>
                            <option value="#922B3E">Burgundy</option>
                            <option value="#C41E3A">Red</option>
                            <option value="#FF69B4">Hot Pink</option>
                            <option value="#FFB6C1">Light Pink</option>
                            <option value="#4B0082">Indigo</option>
                            <option value="#1E90FF">Royal Blue</option>
                            <option value="#4169E1">Cornflower Blue</option>
                            <option value="#00BFFF">Sky Blue</option>
                            <option value="#20B2AA">Teal</option>
                            <option value="#228B22">Forest Green</option>
                            <option value="#008000">Green</option>
                            <option value="#7CFC00">Lime Green</option>
                            <option value="#FFFF00">Yellow</option>
                            <option value="#FFA500">Orange</option>
                            <option value="#8B4513">Saddle Brown</option>
                            <option value="#808000">Olive</option>
                            <option value="#800080">Purple</option>
                            <option value="#DDA0DD">Plum</option>
                        </select>
                        <div id="colorPreview" style="width:34px;height:24px;border:1px solid #E0E0E0;border-radius:4px;background:transparent;"></div>
                    </div>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Category *</label>
                    <input type="text" id="category" readonly style="background:#f5f5f5;cursor:not-allowed;">
                </div>
                <div class="form-group">
                    <label id="unitLabel">Unit *</label>
                    <input type="text" id="unit" readonly style="background:#f5f5f5;cursor:not-allowed;">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label id="quantityLabel">Quantity *</label>
                    <input type="number" id="itemQuantity" min="0" step="0.01" required placeholder="Enter quantity">
                </div>
                <div class="form-group">
                    <label id="unitPriceLabel">Unit Price (₱) *</label>
                    <input type="number" id="unitPrice" min="0" step="0.01" placeholder="Enter unit price" required>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn-primary">Add Item</button>
            </div>
        </form>
    `);

    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    document.getElementById('addInventoryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoading('Adding item...');
        try {
            // Parse material and color, generate deterministic sku and name
            const materialValue = document.getElementById('materialType')?.value || '';
            let parsedMaterial = null;
            try { parsedMaterial = JSON.parse(materialValue); } catch (e) { parsedMaterial = { name: 'Material' }; }
            const colorVal = document.getElementById('colorSelect')?.value || '';
            const colorText = document.getElementById('colorSelect')?.selectedOptions?.[0]?.textContent || '';
            let generatedSku = generateSkuForMaterial(parsedMaterial, colorVal);
            let generatedName = generateItemName(parsedMaterial, colorText);

            // If custom material chosen, use user-provided SKU/Name instead (allow fallback to generated if left blank)
            if (parsedMaterial && parsedMaterial.name === '__CUSTOM__') {
                const userSku = (document.getElementById('sku')?.value || '').trim();
                const userName = (document.getElementById('itemName')?.value || '').trim();
                if (userSku) generatedSku = userSku;
                if (userName) generatedName = userName;
            }

            const newItem = {
                sku: generatedSku,
                name: generatedName,
                category: document.getElementById('category').value,
                quantity: parseFloat(document.getElementById('itemQuantity').value),
                unit: document.getElementById('unit').value,
                unitPrice: parseFloat(document.getElementById('unitPrice').value) || getStandardPrice(parsedMaterial.name),
                source: 'manual',
                color: colorVal || null,
                materialType: document.getElementById('materialType').value,
                addedDate: new Date().toLocaleDateString(),
                addedBy: AppState.currentUser.username
            };

            // If an item with same SKU exists, merge quantities instead of creating duplicate
            const existing = (AppState.inventoryManagementItems || []).find(i => i.sku === newItem.sku);
            if (existing) {
                existing.quantity = (existing.quantity || 0) + (newItem.quantity || 0);
                existing.unitPrice = newItem.unitPrice;
                showMessage('Updated', 'Existing item ' + existing.sku + ' updated with new quantity', 'success');
            } else {
                AppState.inventoryManagementItems.push(newItem);
                showMessage('Success', 'Item ' + newItem.sku + ' added successfully!', 'success');
            }
            await syncDataToFirestore();
            hideLoading();
            closeModal();
            renderInventoryTabs();
        } catch (err) {
            hideLoading();
            showMessage('Error', 'Failed to add item: ' + (err.message || err), 'error');
        }
    });
}

// Update unit field and quantity label based on selected material
function updateUnitAndQuantityLabel() {
    const materialValue = document.getElementById('materialType').value;

    if (!materialValue) {
        document.getElementById('category').value = '';
        document.getElementById('unit').value = '';
        document.getElementById('unitPrice').value = '';
        document.getElementById('unitPriceLabel').textContent = 'Unit Price *';
        document.getElementById('quantityLabel').textContent = 'Quantity *';
        return;
    }

    try {
        const material = JSON.parse(materialValue);
        document.getElementById('category').value = material.category;
        document.getElementById('unit').value = material.unit;

        const skuInput = document.getElementById('sku');
        const nameInput = document.getElementById('itemName');
        const colorContainer = document.getElementById('colorContainer');

        // If user selected the Custom option (name === '__CUSTOM__'), allow editing SKU and Name
        if (material.name === '__CUSTOM__') {
            if (skuInput) {
                skuInput.removeAttribute('readonly');
                skuInput.style.background = '#fff';
            }
            if (nameInput) {
                nameInput.removeAttribute('readonly');
                nameInput.style.background = '#fff';
            }

            // Show color picker (available for fabrics, accessories, and other items)
            if (colorContainer) colorContainer.style.display = 'block';

            // Clear unit price default so user can enter custom price
            document.getElementById('unitPrice').value = '';
            document.getElementById('unitPriceLabel').textContent = `Unit Price (₱ per ${material.unit}) *`;

            // Adjust quantity label
            if (material.unit === 'yards' || material.unit === 'meters') {
                document.getElementById('quantityLabel').textContent = `${material.unit.charAt(0).toUpperCase() + material.unit.slice(1)} Needed *`;
            } else {
                document.getElementById('quantityLabel').textContent = 'Quantity (pieces) *';
            }
        } else {
            // Non-custom selection: make SKU/Name read-only and auto-generate if empty
            if (skuInput) {
                skuInput.setAttribute('readonly', 'readonly');
                skuInput.style.background = '#f5f5f5';
            }
            if (nameInput) {
                nameInput.setAttribute('readonly', 'readonly');
                nameInput.style.background = '#f5f5f5';
            }

            // Format the unit price display with the unit and set numeric value so user can edit
            const price = getStandardPrice(material.name);
            document.getElementById('unitPrice').value = price.toFixed(2);
            document.getElementById('unitPriceLabel').textContent = `Unit Price (₱ per ${material.unit}) *`;

            // Update label based on unit
            if (material.unit === 'yards' || material.unit === 'meters') {
                document.getElementById('quantityLabel').textContent = `${material.unit.charAt(0).toUpperCase() + material.unit.slice(1)} Needed *`;
            } else {
                document.getElementById('quantityLabel').textContent = 'Quantity (pieces) *';
            }

            // Auto-generate SKU and Item Name if empty
            try {
                const colorVal = document.getElementById('colorSelect')?.value || '';
                const colorText = document.getElementById('colorSelect')?.selectedOptions?.[0]?.textContent || '';
                if (skuInput && !skuInput.value) skuInput.value = generateSkuForMaterial(material, colorVal);
                if (nameInput && !nameInput.value) nameInput.value = generateItemName(material, colorText);
            } catch (e) {
                console.warn('Auto-generate sku/name failed', e);
            }

            // Show color picker (available for fabrics, accessories, and other items)
            if (colorContainer) colorContainer.style.display = 'block';
        }
    } catch (e) {
        console.error('Error parsing material:', e);
    }
}

// Generate a compact SKU for a material: BASE-<6digits>
function generateSkuForMaterial(material, colorHex) {
    const namePart = (material && material.name ? material.name : 'MAT').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const base = namePart.slice(0, 6) || 'MAT';
    const seed = `${namePart}|${(colorHex || '').toString().toUpperCase()}`;
    // djb2 hash
    let h = 5381;
    for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) + h) + seed.charCodeAt(i);
        h = h & 0xFFFFFFFF;
    }
    const hex = (h >>> 0).toString(16).toUpperCase().slice(-4);
    return `${base}-${hex}`;
}

function generateItemName(material, colorText) {
    let nm = material && material.name ? material.name : 'Material';
    if (colorText && colorText !== '-- None --') nm += ' - ' + colorText;
    return nm;
}

// Update the small color preview box when user selects a color
function updateColorPreview() {
    const val = document.getElementById('colorSelect')?.value || '';
    const prev = document.getElementById('colorPreview');
    if (!prev) return;
    if (!val) {
        prev.style.background = 'transparent';
        prev.style.border = '1px solid #E0E0E0';
    } else {
        prev.style.background = val;
        prev.style.border = '1px solid #ccc';
    }
}

function renderInventoryTabs() {
    // Get all items
    const items = AppState.inventoryManagementItems || [];
    const accessoriesCats = ['Accessory', 'Button', 'Zipper', 'Fastener', 'Yarn'];

    // Categorize items
    const fabrics = items.filter(i => i.category === 'Fabric');
    const accessories = items.filter(i => accessoriesCats.includes(i.category));
    const otherItems = items.filter(i => i.category && !['Fabric'].concat(accessoriesCats).includes(i.category));
    const lowStockItems = items.filter(item => item.quantity <= (item.minStock || 10) && item.quantity > 0);
    const outOfStockItems = items.filter(item => item.quantity === 0);

    // Render Fabrics Tab
    const fabricsBody = document.getElementById('fabricsTabBody');
    if (fabricsBody) {
        if (fabrics.length === 0) {
            fabricsBody.innerHTML = '<tr><td colspan="7" style="padding:1.5rem;text-align:center;color:var(--text-muted);">No fabrics found</td></tr>';
        } else {
            fabricsBody.innerHTML = fabrics.map(item => renderInventoryRow(item, 'fabric')).join('');
        }
    }

    // Render Accessories Tab
    const accessoriesBody = document.getElementById('accessoriesTabBody');
    if (accessoriesBody) {
        if (accessories.length === 0) {
            accessoriesBody.innerHTML = '<tr><td colspan="8" style="padding:1.5rem;text-align:center;color:var(--text-muted);">No accessories found</td></tr>';
        } else {
            accessoriesBody.innerHTML = accessories.map(item => renderInventoryRow(item, 'accessory')).join('');
        }
    }

    // Render Other Items Tab
    const otherBody = document.getElementById('otherTabBody');
    if (otherBody) {
        if (otherItems.length === 0) {
            otherBody.innerHTML = '<tr><td colspan="8" style="padding:1.5rem;text-align:center;color:var(--text-muted);">No other materials found</td></tr>';
        } else {
            otherBody.innerHTML = otherItems.map(item => renderInventoryRow(item, 'other')).join('');
        }
    }

    // Render Low Stock Tab
    const lowstockBody = document.getElementById('lowstockTabBody');
    if (lowstockBody) {
        const allLowStockItems = [...lowStockItems, ...outOfStockItems];
        if (allLowStockItems.length === 0) {
            lowstockBody.innerHTML = '<tr><td colspan="6" style="padding:1.5rem;text-align:center;color:var(--text-success);font-weight:600;">✓ All items in stock</td></tr>';
        } else {
            lowstockBody.innerHTML = allLowStockItems.map(item => {
                const status = item.quantity === 0 ? '🔴 Out of Stock' : '🟡 Low Stock';
                return `
                    <tr style="background:${item.quantity === 0 ? '#FFE8E8' : '#FFF9E6'};">
                        <td style="padding:0.75rem;">${item.sku}</td>
                        <td style="padding:0.75rem;">${item.name}</td>
                        <td style="padding:0.75rem;">${item.category}</td>
                        <td style="padding:0.75rem;text-align:right;font-weight:600;">${item.quantity} ${item.unit || ''}</td>
                        <td style="padding:0.75rem;text-align:center;">${status}</td>
                        <td style="padding:0.75rem;text-align:center;">
                            <button class="action-btn action-btn-edit" onclick="editItem('${item.sku}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Restock</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // Render Usage History Tab
    renderHistoryTab();

    // Update statistics in one pass (optimized batching)
    updateInventoryStatistics();
}

function renderInventoryRow(item, type) {
    const totalValue = ((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2);
    const status = getInventoryStatus(item);
    const statusColor = status.includes('Out') ? '#FFE8E8' : status.includes('Low') ? '#FFF9E6' : 'transparent';

    if (type === 'fabric') {
        return `
            <tr style="background:${statusColor};">
                <td style="padding:0.75rem;">${item.sku}</td>
                <td style="padding:0.75rem;">${item.name}</td>
                <td style="padding:0.75rem;text-align:right;">${(item.quantity || 0).toFixed(2)}</td>
                <td style="padding:0.75rem;">${item.unit || 'yards'}</td>
                <td style="padding:0.75rem;text-align:right;">₱${(item.unitPrice || 0).toFixed(2)}</td>
                <td style="padding:0.75rem;text-align:right;">₱${totalValue}</td>
                <td style="padding:0.75rem;text-align:center;font-size:0.8rem;font-weight:600;">${status}</td>
                <td style="padding:0.75rem;text-align:center;">
                    <button class="action-btn action-btn-edit" onclick="editItem('${item.sku}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">Edit</button>
                    <button class="action-btn action-btn-delete" onclick="deleteItem('${item.sku}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Delete</button>
                </td>
            </tr>`;
    } else if (type === 'accessory') {
        return `
            <tr style="background:${statusColor};">
                <td style="padding:0.75rem;">${item.sku}</td>
                <td style="padding:0.75rem;">${item.name}</td>
                <td style="padding:0.75rem;text-align:right;">${item.quantity || 0}</td>
                <td style="padding:0.75rem;">${item.category}</td>
                <td style="padding:0.75rem;text-align:right;">₱${(item.unitPrice || 0).toFixed(2)}</td>
                <td style="padding:0.75rem;text-align:right;">₱${totalValue}</td>
                <td style="padding:0.75rem;text-align:center;font-size:0.8rem;font-weight:600;">${status}</td>
                <td style="padding:0.75rem;text-align:center;">
                    <button class="action-btn action-btn-edit" onclick="editItem('${item.sku}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">Edit</button>
                    <button class="action-btn action-btn-delete" onclick="deleteItem('${item.sku}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Delete</button>
                </td>
            </tr>`;
    } else {
        return `
            <tr style="background:${statusColor};">
                <td style="padding:0.75rem;">${item.sku}</td>
                <td style="padding:0.75rem;">${item.name}</td>
                <td style="padding:0.75rem;text-align:right;">${item.quantity || 0}</td>
                <td style="padding:0.75rem;">${item.category}</td>
                <td style="padding:0.75rem;text-align:right;">₱${(item.unitPrice || 0).toFixed(2)}</td>
                <td style="padding:0.75rem;text-align:right;">₱${totalValue}</td>
                <td style="padding:0.75rem;text-align:center;font-size:0.8rem;font-weight:600;">${status}</td>
                <td style="padding:0.75rem;text-align:center;">
                    <button class="action-btn action-btn-edit" onclick="editItem('${item.sku}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">Edit</button>
                    <button class="action-btn action-btn-delete" onclick="deleteItem('${item.sku}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Delete</button>
                </td>
            </tr>`;
    }
}

function switchInventoryTab(tabName) {
    // Hide all tabs and remove active class
    document.querySelectorAll('.inventory-tab-content').forEach(tab => {
        tab.classList.remove('active');
        tab.style.display = 'none';
    });

    // Update button styles
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabName) {
            btn.style.background = 'linear-gradient(135deg, #D4AF37, #B8941E)';
            btn.style.color = 'white';
            btn.style.boxShadow = '0 4px 12px rgba(212, 175, 55, 0.3)';
        } else {
            btn.style.background = '#F0EBE3';
            btn.style.color = '#2C3639';
            btn.style.boxShadow = '0 2px 8px rgba(44, 54, 57, 0.06)';
        }
    });

    // Show selected tab with animation
    const tabElement = document.getElementById(tabName + 'Tab');
    if (tabElement) {
        tabElement.classList.add('active');
        tabElement.style.display = 'block';
    }
}

function filterInventoryTab(tabName) {
    const searchId = tabName + 'Search';
    const searchValue = document.getElementById(searchId)?.value.toLowerCase() || '';
    const bodyId = tabName + 'TabBody';
    const bodyElement = document.getElementById(bodyId);

    if (!bodyElement) return;

    // Get all rows
    const rows = bodyElement.querySelectorAll('tr');
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchValue) ? '' : 'none';
    });
}

function getInventoryStatus(item) {
    if (item.quantity === 0) return '🔴 Out of Stock';
    if (item.quantity <= (item.minStock || 10)) return '🟡 Low Stock';
    return '✓ In Stock';
}

function renderHistoryTab() {
    const historyContainer = document.getElementById('historyContainer');
    if (!historyContainer) return;

    const history = AppState.inventoryDeductionHistory || [];

    if (history.length === 0) {
        historyContainer.innerHTML = `
            <div style="padding:2rem;text-align:center;color:var(--text-muted);">
                <p style="font-size:1.1rem;margin-bottom:0.5rem;">📭 No deduction history yet</p>
                <p>Inventory deductions will appear here when production batches are created.</p>
            </div>
        `;
        return;
    }

    // Read search query and normalize
    const q = (document.getElementById('historySearch')?.value || '').trim().toLowerCase();

    // Sort by timestamp (newest first)
    let sortedHistory = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // If there's a search query, filter records by batchId, orderId, customerName, garmentType, timestamp or any deducted item name
    if (q) {
        sortedHistory = sortedHistory.filter(record => {
            const fields = [record.batchId, record.orderId, record.customerName, record.garmentType, record.timestamp].filter(Boolean).map(x => String(x).toLowerCase()).join(' ');
            if (fields.includes(q)) return true;
            const items = (record.deductedItems || []).map(i => (i.itemName || '') + ' ' + (i.sku || '')).join(' ').toLowerCase();
            if (items.includes(q)) return true;
            return false;
        });
    }

    historyContainer.innerHTML = sortedHistory.map((record, idx) => {
        const items = record.deductedItems || [];
        return `
            <div style="border:1px solid var(--border);border-radius:6px;padding:1rem;margin-bottom:1rem;background:white;">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.75rem;">
                    <div>
                        <h4 style="margin:0;color:var(--navy-dark);">Batch: ${record.batchId}</h4>
                        <p style="margin:0.25rem 0;color:var(--text-muted);font-size:0.85rem;">
                            <strong>Order:</strong> ${record.orderId} | <strong>Customer:</strong> ${record.customerName}
                        </p>
                        <p style="margin:0.25rem 0;color:var(--text-muted);font-size:0.85rem;">
                            <strong>Date:</strong> ${record.timestamp}
                        </p>
                    </div>
                    <div style="text-align:right;">
                        <span style="background:var(--gold-primary);color:white;padding:0.3rem 0.8rem;border-radius:4px;font-size:0.85rem;font-weight:600;">${record.garmentType} × ${record.quantity} pcs</span>
                        <div style="margin-top:0.5rem;">
                            <button class="btn btn-danger" style="padding:0.35rem 0.6rem;font-size:0.8rem;" onclick="confirmDeleteDeduction('${record.timestamp.replace(/'/g, "\'")}')">Delete</button>
                        </div>
                    </div>
                </div>
                
                <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);">
                    <h5 style="margin:0 0 0.5rem 0;color:var(--navy-dark);font-size:0.9rem;">Deducted Items:</h5>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:0.75rem;">
                        ${items.map(item => `
                            <div style="background:#f9f9f9;padding:0.75rem;border-radius:4px;border-left:3px solid ${item.lowStock ? '#F39C12' : 'var(--gold-primary)'};">
                                <p style="margin:0;font-weight:600;color:var(--navy-dark);">📦 ${item.itemName}</p>
                                <p style="margin:0.25rem 0;color:var(--text-muted);font-size:0.85rem;">
                                    <strong>${(typeof item.quantity === 'number') ? item.quantity.toFixed(2) : item.quantity} ${item.unit}</strong>
                                    ${item.lowStock ? ' <span style="color:#F39C12;font-weight:600;">(Low Stock Alert)</span>' : ''}
                                </p>
                                <p style="margin:0;color:var(--text-muted);font-size:0.85rem;">
                                    <small>Unit Price: ₱${(item.unitPrice || 0).toFixed(2)} &nbsp;|&nbsp; Total: <strong>₱${(item.totalPrice || 0).toFixed(2)}</strong></small>
                                </p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function confirmDeleteDeduction(timestamp) {
    const record = (AppState.inventoryDeductionHistory || []).find(r => r.timestamp === timestamp);
    if (!record) return;
    const modal = createModal('Delete Deduction Record', `
        <div style="padding:1rem;text-align:center;">
            <p style="font-size:1rem;color:#c62828;margin-bottom:0.5rem;">🗑️ Delete deduction record?</p>
            <p style="color:var(--text-muted);margin-bottom:1rem;">Batch: <strong>${record.batchId}</strong><br/>Order: <strong>${record.orderId}</strong></p>
            <div style="display:flex;gap:0.5rem;justify-content:center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding:0.6rem 1rem;">Cancel</button>
                <button class="btn btn-primary" onclick="deleteDeductionConfirmed('${timestamp.replace(/'/g, "\'")}')" style="padding:0.6rem 1rem;background:#c62828;color:white;">Delete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function deleteDeductionConfirmed(timestamp) {
    showLoading('Deleting deduction record...');
    try {
        AppState.inventoryDeductionHistory = (AppState.inventoryDeductionHistory || []).filter(r => r.timestamp !== timestamp);
        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderHistoryTab();
        renderInventoryTabs();
        showMessage('Success', 'Deduction record deleted', 'success');
    } catch (err) {
        hideLoading();
        showMessage('Error', 'Failed to delete record: ' + (err.message || err), 'error');
    }
}

function updateInventoryStatistics() {
    const totalItemsCountEl = document.getElementById('totalItemsCount');
    const lowStockCountEl = document.getElementById('lowStockCount');
    const outOfStockCountEl = document.getElementById('outOfStockCount');
    const totalValueEl = document.getElementById('totalValue');

    if (totalItemsCountEl) totalItemsCountEl.textContent = (AppState.inventoryManagementItems || []).length;

    const lowStock = (AppState.inventoryManagementItems || []).filter(item =>
        item.quantity > 0 && item.quantity <= (item.minStock || 10)
    ).length;
    if (lowStockCountEl) lowStockCountEl.textContent = lowStock;

    const outOfStock = (AppState.inventoryManagementItems || []).filter(item => item.quantity === 0).length;
    if (outOfStockCountEl) outOfStockCountEl.textContent = outOfStock;

    const total = (AppState.inventoryManagementItems || []).reduce((sum, item) =>
        sum + (item.quantity * item.unitPrice), 0
    );
    if (totalValueEl) totalValueEl.textContent = '₱' + total.toFixed(2);
}

function applyInventoryFilters() {
    renderInventoryTabs();
}

function viewItem(sku) {
    const item = (AppState.inventoryManagementItems || []).find(i => i.sku === sku);
    if (!item) return;

    const content = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
            <div>
                <p><strong>SKU:</strong> ${item.sku}</p>
                <p><strong>Name:</strong> ${item.name}</p>
                <p><strong>Category:</strong> ${item.category}</p>
                <p><strong>Quantity:</strong> <span id="view_qty">${item.quantity}</span> ${item.unit}</p>
                <p><strong>Unit Price:</strong> ₱${(item.unitPrice || 0).toFixed(2)}</p>
            </div>
            <div>
                <p><strong>Description</strong></p>
                <p style="color:var(--text-muted);">${item.description || '-'}</p>
                ${item.imageUrl ? `<div style="margin-top:0.5rem;"><img src="${item.imageUrl}" alt="${item.name}" style="max-width:180px;border:1px solid #E0E0E0;padding:6px;border-radius:6px;"/></div>` : ''}
                <div style="margin-top:1rem; display:flex; gap:0.5rem;">
                    <input id="adjQty" type="number" placeholder="Qty +/-" style="flex:1;padding:0.5rem;border:1px solid #E0E0E0;border-radius:6px;">
                    <button class="btn btn-primary" onclick="(function(){ const v=parseFloat(document.getElementById('adjQty').value)||0; adjustInventoryQuantity('${item.sku}', v); })()">Apply</button>
                </div>
                <div style="margin-top:1rem; display:flex; gap:0.5rem;">
                    <button class="btn btn-outline" onclick="editItem('${item.sku}')">Edit</button>
                    <button class="btn btn-danger" onclick="deleteItem('${item.sku}')">Delete</button>
                </div>
            </div>
        </div>
    `;

    const modal = createModal('Item Details - ' + item.sku, content);
    document.getElementById('modalContainer').innerHTML = '';
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function viewCatalogItem(sku) {
    const item = (AppState.inventoryCatalogItems || []).find(i => i.sku === sku);
    if (!item) return;

    const content = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
            <div>
                <p><strong>SKU:</strong> ${item.sku}</p>
                <p><strong>Name:</strong> ${item.name}</p>
                <p><strong>Category:</strong> ${item.category || '-'}</p>
                <p><strong>Quantity:</strong> ${item.quantity || 0} ${item.unit || 'pcs'}</p>
                <p><strong>Unit Price:</strong> ₱${(item.unitPrice || 0).toFixed(2)}</p>
                ${item.source ? `<p><strong>Source:</strong> ${item.source}</p>` : ''}
            </div>
            <div>
                <p><strong>Description</strong></p>
                <p style="color:var(--text-muted);">${item.description || '-'}</p>
                ${item.image ? `<div style="margin-top:0.5rem;"><img src="${item.image}" alt="${item.name}" style="max-width:180px;border:1px solid #E0E0E0;padding:6px;border-radius:6px;"/></div>` : ''}
                ${item.orderCustomer ? `<div style="margin-top:1rem;"><p><strong>Customer:</strong> ${item.orderCustomer}</p></div>` : ''}
                <div style="margin-top:1rem; display:flex; gap:0.5rem;">
                    <button class="btn btn-outline" onclick="closeModal()">Close</button>
                    <button class="btn btn-danger" onclick="closeModal(); deleteCatalogItemConfirm('${item.sku}')">Delete</button>
                </div>
            </div>
        </div>
    `;

    const modal = createModal('Catalog Item - ' + item.sku, content);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function editItem(sku) {
    const item = (AppState.inventoryManagementItems || []).find(i => i.sku === sku);
    if (!item) return;

    const unitDisplay = item.unit === 'yards' ? '/yard' : item.unit === 'skeins' ? '/skein' : '/piece';

    const modalContent = `
        <form id="editInventoryForm">
            <div class="form-row">
                <div class="form-group">
                    <label>SKU</label>
                    <input type="text" id="edit_sku" value="${item.sku}" disabled>
                </div>
                <div class="form-group">
                    <label>Item Name</label>
                    <input type="text" id="edit_name" value="${item.name}" disabled>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Category</label>
                    <input type="text" id="edit_category" value="${item.category}" disabled>
                </div>
                <div class="form-group">
                    <label>Unit</label>
                    <input type="text" id="edit_unit" value="${item.unit}" disabled>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Quantity</label>
                    <input type="number" id="edit_quantity" value="${item.quantity}">
                </div>
                <div class="form-group">
                    <label>Unit Price (${item.unit})</label>
                    <input type="number" id="edit_unitprice" value="${item.unitPrice.toFixed(2)}" step="0.01" min="0">
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn-primary">Save Changes</button>
            </div>
        </form>
    `;

    const modal = createModal('Edit Inventory - ' + item.sku, modalContent);
    document.getElementById('modalContainer').innerHTML = '';
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    document.getElementById('editInventoryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoading('Saving item...');
        try {
            item.quantity = parseFloat(document.getElementById('edit_quantity').value) || 0;
            item.unitPrice = parseFloat(document.getElementById('edit_unitprice').value) || item.unitPrice;

            await syncDataToFirestore();
            hideLoading();
            closeModal();
            renderInventoryTabs();
            showMessage('Success', 'Item updated successfully!', 'success');
        } catch (err) {
            hideLoading();
            showMessage('Error', 'Failed to save changes: ' + (err.message || err), 'error');
        }
    });
}

// Adjust inventory quantity by delta (positive or negative)
async function adjustInventoryQuantity(sku, delta) {
    const item = (AppState.inventoryManagementItems || []).find(i => i.sku === sku);
    if (!item) return;

    showLoading('Updating inventory...');
    try {
        item.quantity = (item.quantity || 0) + (parseFloat(delta) || 0);
        if (item.quantity < 0) item.quantity = 0;
        const qtyEl = document.getElementById('view_qty');
        if (qtyEl) qtyEl.textContent = item.quantity;

        await syncDataToFirestore();
        renderInventoryTabs();
        showMessage('Success', 'Inventory updated', 'success');
    } catch (err) {
        console.error('Error updating inventory quantity:', err);
        showMessage('Error', 'Failed to update inventory: ' + (err.message || err), 'error');
    } finally {
        hideLoading();
    }

}

function deleteItem(sku) {
    const item = (AppState.inventoryManagementItems || []).find(i => i.sku === sku);
    if (!item) return;

    const modal = createModal('Delete Item', `
        <div style="padding: 1rem; text-align: center;">
            <div style="margin-bottom: 1rem; font-size: 1.2rem; color: #e74c3c;">⚠️ Delete Item?</div>
            <p style="margin-bottom: 0.5rem; color: #333; font-weight: 600;">SKU: ${sku}</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">This action cannot be undone.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6; flex: 1;">Cancel</button>
                <button class="btn btn-primary" onclick="deleteItemConfirmed('${sku}')" style="padding: 0.75rem 1.5rem; background: #e74c3c; color: white; flex: 1;">Delete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function deleteItemConfirmed(sku) {
    closeModal();
    showLoading('Deleting item...');
    try {
        AppState.inventoryManagementItems = (AppState.inventoryManagementItems || []).filter(i => i.sku !== sku);
        renderInventoryTabs();
        await syncDataToFirestore();
        hideLoading();
        showMessage('Success', 'Item deleted successfully!', 'success');
    } catch (error) {
        hideLoading();
        showMessage('Error', 'Failed to delete item: ' + error.message, 'error');
    }
}

function deleteCatalogItemConfirm(sku) {
    const item = (AppState.inventoryCatalogItems || []).find(i => i.sku === sku);
    if (!item) return;

    const modal = createModal('Delete Item', `
        <div style="padding: 1rem; text-align: center;">
            <div style="margin-bottom: 1rem; font-size: 1.2rem; color: #e74c3c;">⚠️ Delete Item from Catalog?</div>
            <p style="margin-bottom: 0.5rem; color: #333; font-weight: 600;">SKU: ${sku}</p>
            <p style="margin-bottom: 0.5rem; color: #333; font-weight: 600;">Name: ${item.name || item.sku}</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">This action cannot be undone.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6; flex: 1;">Cancel</button>
                <button class="btn btn-primary" onclick="deleteCatalogItemConfirmed('${sku}')" style="padding: 0.75rem 1.5rem; background: #e74c3c; color: white; flex: 1;">Delete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function deleteCatalogItemConfirmed(sku) {
    closeModal();
    showLoading('Deleting item from catalog...');
    try {
        AppState.inventoryCatalogItems = (AppState.inventoryCatalogItems || []).filter(i => i.sku !== sku);
        renderOrderCatalog();
        updateOrderStats();
        await syncDataToFirestore();
        hideLoading();
        showMessage('Success', 'Item deleted from catalog successfully!', 'success');
    } catch (error) {
        hideLoading();
        showMessage('Error', 'Failed to delete item: ' + error.message, 'error');
    }
}

// ==========================================
// QUOTATION/ORDER PAGE LOADER
// ==========================================
function loadQuotationPageContent() {
    const contentArea = document.getElementById('contentArea');

    // OPTION A: Always reset quotation state when entering page (single-step creation)
    // This ensures each visit to quotation page starts with a fresh form with no carryover
    AppState.newQuotation = {
        step: 1,
        clientName: '',
        contactNumber: '',
        orderType: 'fob',
        files: [],
        sizes: [],
        colors: [],
        accessories: [],
        notes: '',
        costingData: {}
    };

    const stepContent = getOrderQuotationStepContent(AppState.newQuotation.step);

    contentArea.innerHTML = `
        <div class="quotation-page-container">
            <div class="quotation-page-header">
                <button class="back-button" onclick="navigateTo('orders')">
                    <span>←</span> Back to Orders
                </button>
                <div class="quotation-page-title">
                    <h1>Order & Quotation Module</h1>
                    <p>Garment Manufacturing Integrated Management System</p>
                </div>
                <div class="quotation-page-orderno">ORD-2026-0001</div>
            </div>
            
            <div class="quotation-page-stepper">
                <div class="stepper-container">
                    <div class="step-item ${AppState.newQuotation.step === 1 ? 'active' : (AppState.newQuotation.step > 1 ? 'completed' : '')}" data-step="1">
                        <div class="step-circle">1</div>
                        <div class="step-label">Client Info</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item ${AppState.newQuotation.step === 2 ? 'active' : (AppState.newQuotation.step > 2 ? 'completed' : '')}" data-step="2">
                        <div class="step-circle">2</div>
                        <div class="step-label">Order Details</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item ${AppState.newQuotation.step === 3 ? 'active' : (AppState.newQuotation.step > 3 ? 'completed' : '')}" data-step="3">
                        <div class="step-circle">3</div>
                        <div class="step-label">Design Files</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item ${AppState.newQuotation.step === 4 ? 'active' : (AppState.newQuotation.step > 4 ? 'completed' : '')}" data-step="4">
                        <div class="step-circle">4</div>
                        <div class="step-label">Specifications</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item ${AppState.newQuotation.step === 5 ? 'active' : (AppState.newQuotation.step > 5 ? 'completed' : '')}" data-step="5">
                        <div class="step-circle">5</div>
                        <div class="step-label">Accessories</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item ${AppState.newQuotation.step === 6 ? 'active' : (AppState.newQuotation.step > 6 ? 'completed' : '')}" data-step="6">
                        <div class="step-circle">6</div>
                        <div class="step-label">Approval Sheet</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item ${AppState.newQuotation.step === 7 ? 'active' : (AppState.newQuotation.step > 7 ? 'completed' : '')}" data-step="7">
                        <div class="step-circle">7</div>
                        <div class="step-label">Review</div>
                    </div>
                </div>
            </div>
            
            <div class="quotation-page-body">
                ${stepContent}
            </div>
        </div>
    `;

    // Attach event handlers
    attachQuotationHandlers();
}

// ==========================================
// OTHER MODULES (Placeholder Content)
// ==========================================
function loadProductionContent() {
    // Data is automatically synced from Firestore via real-time listeners

    const contentArea = document.getElementById('contentArea');

    // Compute pending receipts count (completed + passed QC without a production_receipt, excluding delivered orders)
    const receiptsPendingCount = (AppState.productions || []).filter(p => {
        const hasReceipt = (AppState.billings || []).some(b => b.type === 'production_receipt' && b.batchId === p.batchId);
        const order = AppState.orders.find(o => o.orderId === p.orderRef);
        return p.status === 'completed' && p.qcStatus === 'passed' && order && order.status !== 'completed' && !hasReceipt;
    }).length;

    contentArea.innerHTML = `
        <div class="production-page" style="display: flex; flex-direction: column; gap: 2rem; padding: 0.25rem 0.25rem;">
            <!-- Stats Grid -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem;">
                <div style="background: white; padding: 2rem; border-radius: 14px; box-shadow: 0 2px 8px rgba(44, 54, 57, 0.06);">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 1.5rem;">
                        <div style="width: 56px; height: 56px; border-radius: 10px; background: linear-gradient(135deg, #D4AF37, #B8941E); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.25); font-size: 28px;">⚙️</div>
                        <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #576f72;">In Production</div>
                    </div>
                    <div style="font-family: 'Playfair Display', serif; font-size: 44px; font-weight: 700; color: #2c3639;" id="prodInProgressCount">0</div>
                </div>
                <div style="background: white; padding: 2rem; border-radius: 14px; box-shadow: 0 2px 8px rgba(44, 54, 57, 0.06);">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 1.5rem;">
                        <div style="width: 56px; height: 56px; border-radius: 10px; background: linear-gradient(135deg, #D4AF37, #B8941E); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.25); font-size: 28px;">✅</div>
                        <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #576f72;">Completed</div>
                    </div>
                    <div style="font-family: 'Playfair Display', serif; font-size: 44px; font-weight: 700; color: #2c3639;" id="prodCompletedCount">0</div>
                </div>
                <div style="background: white; padding: 2rem; border-radius: 14px; box-shadow: 0 2px 8px rgba(44, 54, 57, 0.06);">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 1.5rem;">
                        <div style="width: 56px; height: 56px; border-radius: 10px; background: linear-gradient(135deg, #D4AF37, #B8941E); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.25); font-size: 28px;">🔍</div>
                        <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #576f72;">Pending QC</div>
                    </div>
                    <div style="font-family: 'Playfair Display', serif; font-size: 44px; font-weight: 700; color: #2c3639;" id="prodQCPendingCount">0</div>
                </div>
            </div>

            <!-- Filter Tabs (4 standalone cards) -->
            <div style="display: grid !important; grid-template-columns: repeat(4, 1fr) !important; gap: 1.5rem;">
                <div class="tab-btn active" data-tab="active-batches" onclick="switchProductionTab('active-batches')" style="background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; padding: 2rem; border-radius: 14px; border: none; cursor: pointer; transition: all 0.3s; display: flex; flex-direction: column; align-items: center; gap: 12px; font-size: 14px; font-weight: 700; text-align: center; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3);">
                    <span style="font-size: 2.5rem;">⚙️</span>
                    <span>ACTIVE BATCHES</span>
                </div>
                <div class="tab-btn" data-tab="completed-batches" onclick="switchProductionTab('completed-batches')" style="background: #F0EBE3; color: #2c3639; padding: 2rem; border-radius: 14px; border: none; cursor: pointer; transition: all 0.3s; display: flex; flex-direction: column; align-items: center; gap: 12px; font-size: 14px; font-weight: 700; text-align: center; box-shadow: 0 2px 8px rgba(44, 54, 57, 0.06);">
                    <span style="font-size: 2.5rem;">✅</span>
                    <span>COMPLETED</span>
                </div>
                <div class="tab-btn" data-tab="qc-inspection" onclick="switchProductionTab('qc-inspection')" style="background: #F0EBE3; color: #2c3639; padding: 2rem; border-radius: 14px; border: none; cursor: pointer; transition: all 0.3s; display: flex; flex-direction: column; align-items: center; gap: 12px; font-size: 14px; font-weight: 700; text-align: center; box-shadow: 0 2px 8px rgba(44, 54, 57, 0.06);">
                    <span style="font-size: 2.5rem;">🔍</span>
                    <span>QC INSPECTION</span>
                </div>
                <div class="tab-btn" data-tab="receipts-queue" onclick="switchProductionTab('receipts-queue')" style="background: #F0EBE3; color: #2c3639; padding: 2rem; border-radius: 14px; border: none; cursor: pointer; transition: all 0.3s; display: flex; flex-direction: column; align-items: center; gap: 12px; font-size: 14px; font-weight: 700; text-align: center; box-shadow: 0 2px 8px rgba(44, 54, 57, 0.06); position: relative;">
                    <span style="font-size: 2.5rem;">🧾</span>
                    <span>GENERATE RECEIPTS</span>
                    <span style="position: absolute; top: 8px; right: 8px; background: rgba(212, 175, 55, 0.2); color: #2c3639; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;">${receiptsPendingCount}</span>
                </div>
            </div>

            <!-- Tab Contents -->
            <div id="active-batchesTab" class="tab-content active" style="display: block;">
                <div style="background: white; border-radius: 14px; padding: 2.5rem; box-shadow: 0 4px 12px rgba(44, 54, 57, 0.08);">
                    <div style="margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #2c3639; margin: 0;">Active Production Batches</h2>
                            <p style="color: #576f72; font-size: 14px; margin: 0.5rem 0 0 0;">Monitor batches currently in production</p>
                        </div>
                        <button onclick="openCreateBatchModal()" style="background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.2);">
                            <span>➕</span> NEW BATCH
                        </button>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 1.5rem;">
                        <thead>
                            <tr style="background: linear-gradient(to right, #faf7f0, #f0ebe3); border-bottom: 2px solid #D4AF37;">
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Batch ID</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Order Ref</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Garment Type</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Qty</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Stage</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Progress</th>
                                <th style="padding: 1rem 1.5rem; text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="productionTableBody">
                            <tr><td colspan="7" style="padding: 3rem 1.5rem; text-align: center; color: #576f72;">No active batches</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="completed-batchesTab" class="tab-content" style="display: none;">
                <div style="background: white; border-radius: 14px; padding: 2.5rem; box-shadow: 0 4px 12px rgba(44, 54, 57, 0.08);">
                    <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #2c3639; margin: 0 0 0.5rem 0;">Completed Batches</h2>
                    <p style="color: #576f72; font-size: 14px; margin: 0 0 1.5rem 0;">View finished production batches</p>
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: linear-gradient(to right, #faf7f0, #f0ebe3); border-bottom: 2px solid #D4AF37;">
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Batch ID</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Order Ref</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Garment Type</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Qty</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Completion Date</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">QC Status</th>
                                <th style="padding: 1rem 1.5rem; text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="completedBatchesBody">
                            <tr><td colspan="7" style="padding: 3rem 1.5rem; text-align: center; color: #576f72;">No completed batches</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="qc-inspectionTab" class="tab-content" style="display: none;">
                <div style="background: white; border-radius: 14px; padding: 2.5rem; box-shadow: 0 4px 12px rgba(44, 54, 57, 0.08);">
                    <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #2c3639; margin: 0 0 0.5rem 0;">Quality Control Inspections</h2>
                    <p style="color: #576f72; font-size: 14px; margin: 0 0 1.5rem 0;">Manage quality checks and inspections</p>
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: linear-gradient(to right, #faf7f0, #f0ebe3); border-bottom: 2px solid #D4AF37;">
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Batch ID</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Garment Type</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Qty</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Inspector</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Inspection Date</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Result</th>
                                <th style="padding: 1rem 1.5rem; text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="qcInspectionBody">
                            <tr><td colspan="7" style="padding: 3rem 1.5rem; text-align: center; color: #576f72;">No QC inspections pending</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="receipts-queueTab" class="tab-content" style="display: none;">
                <div style="background: white; border-radius: 14px; padding: 2.5rem; box-shadow: 0 4px 12px rgba(44, 54, 57, 0.08);">
                    <div style="margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #2c3639; margin: 0;">Generate Order Receipts</h2>
                            <p style="color: #576f72; font-size: 14px; margin: 0.5rem 0 0 0;">Completed and passed batches awaiting receipt generation</p>
                        </div>
                        <button onclick="renderReceiptsQueueTable()" style="background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.2);">REFRESH</button>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 1.5rem;">
                        <thead>
                            <tr style="background: linear-gradient(to right, #faf7f0, #f0ebe3); border-bottom: 2px solid #D4AF37;">
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Batch ID</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Order Ref</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Customer</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Qty</th>
                                <th style="padding: 1rem 1.5rem; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Inspector</th>
                                <th style="padding: 1rem 1.5rem; text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #2c3639;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="receiptsQueueBody">
                            <tr><td colspan="6" style="padding: 3rem 1.5rem; text-align: center; color: #576f72;">No receipts awaiting generation</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Render all tables on load
    renderProductionTable();
    renderCompletedBatchesTable();
    renderQCInspectionTable();
    updateProductionStats();
    renderReceiptsQueueTable();
}

// Production Tab Switching
function switchProductionTab(tabName) {
    // Data is automatically synced from Firestore via real-time listeners

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });

    // Update button styles
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabName) {
            btn.style.background = 'linear-gradient(135deg, #D4AF37, #B8941E)';
            btn.style.color = 'white';
            btn.style.boxShadow = '0 4px 12px rgba(212, 175, 55, 0.3)';
        } else {
            btn.style.background = '#F0EBE3';
            btn.style.color = '#2c3639';
            btn.style.boxShadow = '0 2px 8px rgba(44, 54, 57, 0.06)';
        }
    });

    const tabContent = document.getElementById(tabName + 'Tab');
    if (tabContent) {
        tabContent.classList.add('active');
        tabContent.style.display = 'block';
    }

    // Re-render tables for the selected tab
    if (tabName === 'active-batches') renderProductionTable();
    if (tabName === 'completed-batches') renderCompletedBatchesTable();
    if (tabName === 'qc-inspection') renderQCInspectionTable();
    if (tabName === 'receipts-queue') renderReceiptsQueueTable();

    // Update stats
    updateProductionStats();
}

// Render Active Production Batches Table
function renderProductionTable() {
    const tbody = document.getElementById('productionTableBody');
    if (!tbody) return;

    const activeBatches = AppState.productions.filter(p => p.status !== 'completed');

    if (activeBatches.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-muted);">No active batches. Create a new batch to start production.</td></tr>';
        return;
    }

    tbody.innerHTML = activeBatches.map(batch => `
        <tr>
            <td style="padding: 1rem;">${batch.batchId}</td>
            <td style="padding: 1rem;">${batch.orderRef}</td>
            <td style="padding: 1rem;">${batch.garmentType}</td>
            <td style="padding: 1rem;">${batch.quantity} pcs</td>
            <td style="padding: 1rem;">
                <span style="padding: 0.35rem 0.85rem; border-radius: 20px; font-size: 0.8rem; background: #EBF5FB; color: #3498DB;">${formatStatus(batch.currentStage)}</span>
            </td>
            <td style="padding: 1rem;">
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <div style="flex: 1; height: 6px; background: #E0E0E0; border-radius: 3px;">
                        <div style="height: 100%; width: ${batch.progress}%; background: var(--gold-primary); border-radius: 3px;"></div>
                    </div>
                    <span style="font-size: 0.8rem; color: var(--navy-dark); font-weight: 600;">${batch.progress}%</span>
                </div>
            </td>
            <td style="padding: 1rem; text-align: center;">
                <button class="action-btn action-btn-edit" onclick="openUpdateBatchStageModal('${batch.batchId}')" style="padding: 0.4rem 0.75rem; font-size: 0.75rem; border: 1px solid #F39C12; background: #FFF4E5; color: #F39C12; border-radius: 4px; cursor: pointer;">Update Stage</button>
                <button class="action-btn action-btn-view" onclick="confirmCompleteBatchProduction('${batch.batchId}')" style="padding: 0.4rem 0.75rem; font-size: 0.75rem; border: 1px solid #27AE60; background: #E8F8F5; color: #27AE60; border-radius: 4px; cursor: pointer; margin-left: 0.25rem;">Complete</button>
            </td>
        </tr>
    `).join('');
}

// Render Completed Batches Table
function renderCompletedBatchesTable() {
    const tbody = document.getElementById('completedBatchesBody');
    if (!tbody) return;

    // Filter completed batches only for non-completed orders
    const completedBatches = AppState.productions.filter(p => {
        const order = AppState.orders.find(o => o.orderId === p.orderRef);
        return p.status === 'completed' && order && order.status !== 'completed';
    });

    if (completedBatches.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-muted);">No completed batches yet.</td></tr>';
        return;
    }

    tbody.innerHTML = completedBatches.map(batch => `
        <tr>
            <td style="padding: 1rem;">${batch.batchId}</td>
            <td style="padding: 1rem;">${batch.orderRef}</td>
            <td style="padding: 1rem;">${batch.garmentType}</td>
            <td style="padding: 1rem;">${batch.quantity} pcs</td>
            <td style="padding: 1rem;">${batch.completionDate || 'N/A'}</td>
            <td style="padding: 1rem;">
                <span style="padding: 0.35rem 0.85rem; border-radius: 20px; font-size: 0.8rem; background: ${batch.qcStatus === 'passed' ? '#E8F8F5; color: #27AE60;' : batch.qcStatus === 'failed' ? '#FADBD8; color: #E74C3C;' : '#FFF4E5; color: #F39C12;'}">${batch.qcStatus || 'pending'}</span>
            </td>
            <td style="padding: 1rem; text-align: center;">
                <button class="action-btn action-btn-view" onclick="viewBatchDetails('${batch.batchId}')" style="padding: 0.4rem 0.75rem; font-size: 0.75rem; border: 1px solid #3498DB; background: #EBF5FB; color: #3498DB; border-radius: 4px; cursor: pointer;">View</button>
                ${batch.qcStatus === 'failed' ? `<button class="action-btn action-btn-edit" onclick="sendBatchToRework('${batch.batchId}')" style="padding: 0.4rem 0.75rem; font-size: 0.75rem; border: 1px solid #F39C12; background: #FFF4E5; color: #F39C12; border-radius: 4px; cursor: pointer; margin-left: 0.25rem;">Send to Rework</button>` : ''}
            </td>
        </tr>
    `).join('');
}

// Render QC Inspection Table
function renderQCInspectionTable() {
    const tbody = document.getElementById('qcInspectionBody');
    if (!tbody) return;

    // Filter QC pending batches only for non-completed orders
    const qcPending = AppState.productions.filter(p => {
        const order = AppState.orders.find(o => o.orderId === p.orderRef);
        return p.status === 'completed' && (!p.qcStatus || p.qcStatus === 'pending') && order && order.status !== 'completed';
    });

    if (qcPending.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-muted);">No QC inspections pending.</td></tr>';
        return;
    }

    tbody.innerHTML = qcPending.map(batch => `
        <tr>
            <td style="padding: 1rem;">${batch.batchId}</td>
            <td style="padding: 1rem;">${batch.garmentType}</td>
            <td style="padding: 1rem;">${batch.quantity} pcs</td>
            <td style="padding: 1rem;">${batch.assignedInspector || 'Unassigned'}</td>
            <td style="padding: 1rem;">${batch.inspectionDate || 'Not started'}</td>
            <td style="padding: 1rem;">
                <span style="padding: 0.35rem 0.85rem; border-radius: 20px; font-size: 0.8rem; background: #FFF4E5; color: #F39C12;">Pending</span>
            </td>
            <td style="padding: 1rem; text-align: center;">
                <button class="action-btn action-btn-primary" onclick="openQCInspectionModal('${batch.batchId}')" style="padding: 0.4rem 0.75rem; font-size: 0.75rem; border: 1px solid var(--gold-primary); background: var(--gold-primary); color: white; border-radius: 4px; cursor: pointer;">Start Inspection</button>
            </td>
        </tr>
    `).join('');
}

// Update Production Statistics
function updateProductionStats() {
    const inProgressEl = document.getElementById('prodInProgressCount');
    const completedEl = document.getElementById('prodCompletedCount');
    const qcPendingEl = document.getElementById('prodQCPendingCount');

    const inProgress = AppState.productions.filter(p => p.status !== 'completed').length;
    // Count completed batches only for non-completed orders
    const completed = AppState.productions.filter(p => {
        const order = AppState.orders.find(o => o.orderId === p.orderRef);
        return p.status === 'completed' && order && order.status !== 'completed';
    }).length;
    const qcPending = AppState.productions.filter(p => {
        const order = AppState.orders.find(o => o.orderId === p.orderRef);
        return p.status === 'completed' && (!p.qcStatus || p.qcStatus === 'pending') && order && order.status !== 'completed';
    }).length;

    if (inProgressEl) inProgressEl.textContent = inProgress;
    if (completedEl) completedEl.textContent = completed;
    if (qcPendingEl) qcPendingEl.textContent = qcPending;
}

// Render Receipts Queue Table: completed + passed batches without a production receipt (exclude delivered orders)
function renderReceiptsQueueTable() {
    const tbody = document.getElementById('receiptsQueueBody');
    if (!tbody) return;

    const pending = (AppState.productions || []).filter(p => {
        const order = AppState.orders.find(o => o.orderId === p.orderRef);
        const hasReceipt = (AppState.billings || []).some(b => b.type === 'production_receipt' && b.batchId === p.batchId);
        return p.status === 'completed' && p.qcStatus === 'passed' && order && order.status !== 'completed' && !hasReceipt;
    });

    if (!pending || pending.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="6" style="padding: 2rem; text-align: center; color: var(--text-muted);">No completed & passed batches awaiting receipts.</td></tr>';
        return;
    }

    tbody.innerHTML = pending.map(b => {
        const order = AppState.orders.find(o => o.orderId === b.orderRef) || {};
        return `
            <tr>
                <td style="padding: 1rem;">${b.batchId}</td>
                <td style="padding: 1rem;">${b.orderRef || '-'}</td>
                <td style="padding: 1rem;">${order.customerName || '-'}</td>
                <td style="padding: 1rem;">${b.quantity || 0} pcs</td>
                <td style="padding: 1rem;">${b.assignedInspector || '-'}</td>
                <td style="padding: 1rem; text-align:center;">
                    <button class="action-btn action-btn-view" onclick="viewBatchDetails('${b.batchId}')" style="padding:0.4rem 0.75rem; font-size:0.85rem;">View</button>
                    <button class="action-btn action-btn-edit" onclick="generateReceiptForBatch('${b.batchId}')" style="padding:0.4rem 0.75rem; font-size:0.85rem; background:#27AE60;color:white;border:none;border-radius:4px;cursor:pointer;margin-left:6px;">Generate Receipt</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Helper function: Get employee options filtered by role
function getEmployeeOptionsByRole(role) {
    const employees = (AppState.employees || []).filter(emp => emp.role === role && emp.status === 'active');
    return employees.map(emp => `<option value="${emp.name}">${emp.name}</option>`).join('');
}

// Open Create Batch Modal
function openCreateBatchModal() {
    // Data is automatically kept in sync via Firestore real-time listeners

    // OPTION A: Get orders that don't have batches yet (draft or approved status, not yet in production)
    // Job Order will be created when batch is created
    const availableOrders = AppState.orders.filter(o =>
        o.status !== 'completed' &&
        (o.status === 'draft' || o.status === 'approved' || o.status === 'quoted' || !o.status)
    );

    if (availableOrders.length === 0) {
        showMessage('No Available Orders', 'Submit a quotation first, then create a batch here to start production', 'warning');
        return;
    }

    const modalContent = `
        <div class="quotation-form-section">
            <div class="q-section-header">
                <h2>Create Production Batch</h2>
                <p>Select an order and create a batch to start production</p>
                <div style="margin-top: 0.75rem; padding: 0.75rem; background: #E3F2FD; border-radius: 4px; border-left: 4px solid #2196F3;">
                    <p style="margin: 0; font-size: 0.9rem; color: #1976D2;"><strong>Available:</strong> ${availableOrders.length} order(s) ready for batch creation</p>
                </div>
            </div>

            <div class="q-form-group">
                <label>Select Order <span class="q-required">*</span></label>
                <select id="batchJobSelect" class="q-input" onchange="onBatchJobSelected()">
                    <option value="">-- Select an Order --</option>
                    ${availableOrders.map(order => {
        const statusBadge = order.status === 'draft' ? '📝 ' : '✓ ';
        return `<option value="${order.orderId}">${statusBadge}${order.orderId} - ${order.customerName} (${order.quantity} pcs)</option>`;
    }).join('')}
                </select>
            </div>

            <div class="q-form-group">
                <label>Batch Quantity (pcs) <span class="q-required">*</span></label>
                <input type="number" id="batchQty" class="q-input" min="1" placeholder="Enter quantity">
            </div>

            <div class="q-form-group">
                <label>Starting Stage <span class="q-required">*</span></label>
                <input type="text" class="q-input" value="Designing" readonly style="background-color: #f5f5f5; cursor: not-allowed;">
                <input type="hidden" id="batchStage" value="Designing">
            </div>
            <div class="q-form-group">
                <label>Assigned Worker (Optional)</label>
                <select id="batchWorker" class="q-input">
                    <option value="">-- Select Worker --</option>
                </select>
            </div>

            <div class="q-form-actions">
                <button class="q-btn q-btn-secondary" onclick="closeModal()">Cancel</button>
                <button class="q-btn q-btn-primary" onclick="createProductionBatch()">Create Batch</button>
            </div>
        </div>
    `;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>New Production Batch</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                ${modalContent}
            </div>
        </div>
    `;

    const modalContainer = document.getElementById('modalContainer');
    modalContainer.innerHTML = '';
    modalContainer.appendChild(modal);

    // Populate employee dropdowns after modal is added to DOM
    populateEmployeeDropdown('batchWorker', 'Staff');
}

// Helper: Populate employee dropdowns dynamically
function populateEmployeeDropdown(selectId, role) {
    const selectElement = document.getElementById(selectId);
    if (!selectElement) return;

    const employees = (AppState.employees || []).filter(emp => emp.role === role && emp.status === 'active');

    // Clear existing options (keep the placeholder)
    const placeholder = selectElement.querySelector('option');
    selectElement.innerHTML = '';
    selectElement.appendChild(placeholder);

    // Add employee options
    employees.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.name;
        option.textContent = emp.name;
        selectElement.appendChild(option);
    });
}

// Auto-populate batch quantity when order is selected
function onBatchJobSelected() {
    const orderSelect = document.getElementById('batchJobSelect');
    const qtyInput = document.getElementById('batchQty');

    if (!orderSelect?.value || !qtyInput) return;

    // OPTION A: User selected an Order, populate quantity from order
    const selectedOrder = AppState.orders.find(o => o.orderId === orderSelect.value);
    if (selectedOrder && selectedOrder.quantity) {
        qtyInput.value = selectedOrder.quantity;
    }
}

// Create Production Batch
async function createProductionBatch() {
    showLoading('Creating production batch...');
    try {
        const orderSelect = document.getElementById('batchJobSelect');
        const qtyInput = document.getElementById('batchQty');
        const stageSelect = document.getElementById('batchStage');
        const workerInput = document.getElementById('batchWorker');

        if (!orderSelect?.value || !qtyInput?.value) {
            hideLoading();
            showMessage('Required Fields', 'Please select an order and enter quantity', 'warning');
            return;
        }

        // OPTION A: User selected an Order, not a Job Order
        const selectedOrder = AppState.orders.find(o => o.orderId === orderSelect.value);
        if (!selectedOrder) {
            hideLoading();
            showMessage('Error', 'Order not found', 'error');
            return;
        }

        // Validate that the order is NOT completed
        if (selectedOrder.status === 'completed') {
            hideLoading();
            showMessage('Invalid Order', `Order ${selectedOrder.orderId} is already completed/delivered. Cannot create batches for delivered orders.`, 'warning');
            return;
        }

        // OPTION A: Create Job Order if it doesn't exist (moved from quotation submission)
        let jobOrder = AppState.jobOrders.find(j => j.orderRef === selectedOrder.orderId);
        if (!jobOrder) {
            jobOrder = {
                jobId: `JOB-${Date.now()}`,
                orderRef: selectedOrder.orderId,
                garmentType: selectedOrder.garmentType,
                quantity: selectedOrder.quantity,
                colors: selectedOrder.colors || selectedOrder.color || 'As per design',
                stage: stageSelect.value,
                progress: 0,
                assignedTo: workerInput.value || 'Unassigned',
                status: 'in-progress',
                createdDate: new Date().toLocaleDateString(),
                dueDate: selectedOrder.deliveryDate,
                notes: selectedOrder.specialInstructions || ''
            };
            AppState.jobOrders.push(jobOrder);
        } else {
            // If job order already exists, just update it
            jobOrder.status = 'in-progress';
            jobOrder.stage = stageSelect.value;
            jobOrder.assignedTo = workerInput.value || 'Unassigned';
        }

        const newBatch = {
            batchId: `BAT-${Date.now()}`,
            orderRef: selectedOrder.orderId,
            jobId: jobOrder.jobId,
            garmentType: selectedOrder.garmentType || 'Custom',
            quantity: parseInt(qtyInput.value),
            currentStage: stageSelect.value,
            progress: 0,
            assignedWorker: workerInput.value || 'Unassigned',
            status: 'in-progress',
            createdDate: new Date().toLocaleDateString(),
            createdBy: AppState.currentUser?.username || 'system',
            qcStatus: 'pending',
            notes: ''
        };

        AppState.productions.push(newBatch);

        // Update related order status to in_production (if not already in deeper stage)
        if (selectedOrder.status !== 'in_production' && selectedOrder.status !== 'ready_for_delivery' && selectedOrder.status !== 'completed') {
            selectedOrder.status = 'in_production';
        }

        // ==========================================
        // INVENTORY DEDUCTION: Deduct fabrics and accessories from inventory
        // ==========================================
        const deductedItems = [];
        const deductionRecord = {
            timestamp: new Date().toLocaleString(),
            batchId: newBatch.batchId,
            orderId: selectedOrder.orderId,
            customerName: selectedOrder.customerName,
            garmentType: selectedOrder.garmentType,
            quantity: newBatch.quantity,
            deductedItems: []
        };

        // Deduct fabrics (from colors array)
        if (selectedOrder.colors && selectedOrder.colors.length > 0) {
            selectedOrder.colors.forEach(color => {
                if (color.fabricSku) {
                    const fabricItem = AppState.inventoryManagementItems.find(i => i.sku === color.fabricSku);
                    if (fabricItem) {
                        // Deduct based on the number of yards needed for the batch
                        const yardsToDeduct = color.yards * (newBatch.quantity / selectedOrder.quantity);
                        if (fabricItem.quantity >= yardsToDeduct) {
                            fabricItem.quantity -= yardsToDeduct;
                            deductedItems.push(`${color.name} Fabric: ${yardsToDeduct.toFixed(2)} yards`);
                            const fabricUnitPrice = parseFloat(fabricItem.unitPrice || 0);
                            const fabricTotal = parseFloat((fabricUnitPrice * yardsToDeduct).toFixed(2));
                            deductionRecord.deductedItems.push({
                                itemName: `${color.name} Fabric`,
                                quantity: parseFloat(yardsToDeduct.toFixed(2)),
                                unit: 'yards',
                                unitPrice: fabricUnitPrice,
                                totalPrice: fabricTotal
                            });
                        } else {
                            // Low stock warning but still allow
                            deductedItems.push(`⚠️ ${color.name} Fabric: Low stock! Deducted ${yardsToDeduct.toFixed(2)} yards (only ${fabricItem.quantity.toFixed(2)} available after)`);
                            fabricItem.quantity = Math.max(0, fabricItem.quantity - yardsToDeduct);
                            const fabricUnitPrice2 = parseFloat(fabricItem.unitPrice || 0);
                            const fabricTotal2 = parseFloat((fabricUnitPrice2 * yardsToDeduct).toFixed(2));
                            deductionRecord.deductedItems.push({
                                itemName: `${color.name} Fabric`,
                                quantity: parseFloat(yardsToDeduct.toFixed(2)),
                                unit: 'yards',
                                unitPrice: fabricUnitPrice2,
                                totalPrice: fabricTotal2,
                                lowStock: true
                            });
                        }
                    }
                }
            });
        }

        // Deduct accessories
        if (selectedOrder.accessories && selectedOrder.accessories.length > 0) {
            selectedOrder.accessories.forEach(acc => {
                const accessoryItem = AppState.inventoryManagementItems.find(i => i.sku === acc.sku);
                if (accessoryItem) {
                    // Deduct based on the number of units needed for the batch
                    const qtyToDeduct = acc.quantity * (newBatch.quantity / selectedOrder.quantity);
                    if (accessoryItem.quantity >= qtyToDeduct) {
                        accessoryItem.quantity -= qtyToDeduct;
                        deductedItems.push(`${acc.name}: ${qtyToDeduct.toFixed(0)} units`);
                        const accUnitPrice = parseFloat(accessoryItem.unitPrice || 0);
                        const accTotal = parseFloat((accUnitPrice * qtyToDeduct).toFixed(2));
                        deductionRecord.deductedItems.push({
                            itemName: acc.name,
                            quantity: parseFloat(qtyToDeduct.toFixed(2)),
                            unit: 'units',
                            unitPrice: accUnitPrice,
                            totalPrice: accTotal
                        });
                    } else {
                        // Low stock warning but still allow
                        deductedItems.push(`⚠️ ${acc.name}: Low stock! Deducted ${qtyToDeduct.toFixed(0)} units (only ${accessoryItem.quantity.toFixed(0)} available after)`);
                        accessoryItem.quantity = Math.max(0, accessoryItem.quantity - qtyToDeduct);
                        const accUnitPrice2 = parseFloat(accessoryItem.unitPrice || 0);
                        const accTotal2 = parseFloat((accUnitPrice2 * qtyToDeduct).toFixed(2));
                        deductionRecord.deductedItems.push({
                            itemName: acc.name,
                            quantity: parseFloat(qtyToDeduct.toFixed(2)),
                            unit: 'units',
                            unitPrice: accUnitPrice2,
                            totalPrice: accTotal2,
                            lowStock: true
                        });
                    }
                }
            });
        }

        // Add deduction record to history
        if (deductionRecord.deductedItems.length > 0) {
            AppState.inventoryDeductionHistory.push(deductionRecord);
        }

        await syncDataToFirestore();
        hideLoading();
        closeModal();

        // Parallelize independent UI updates after sync
        Promise.all([
            Promise.resolve(loadProductionContent()),
            Promise.resolve(updateDashboardStats())
        ]);

        // Show success message with inventory deduction details
        let message = 'Production batch ' + newBatch.batchId + ' created!';
        if (deductedItems.length > 0) {
            message += '\n\nInventory Deducted:\n' + deductedItems.join('\n');
        }
        showMessage('Success', message, 'success');
    } catch (error) {
        hideLoading();
        console.error('Error creating production batch:', error);
        showMessage('Error', 'Failed to create batch: ' + error.message, 'error');
    }
}

// Open Update Batch Stage Modal
function openUpdateBatchStageModal(batchId) {
    const batch = AppState.productions.find(p => p.batchId === batchId);
    if (!batch) return;

    const stages = ['Designing', 'Cutting', 'Sewing', 'Completed'];
    const stageToProgress = { 'Designing': 25, 'Cutting': 50, 'Sewing': 75, 'Completed': 100 };
    const currentIndex = stages.indexOf(batch.currentStage);

    const modalContent = `
        <div class="quotation-form-section">
            <div class="q-section-header">
                <h2>Update Production Stage</h2>
                <p>Batch: ${batch.batchId}</p>
            </div>

            <div class="q-form-group">
                <label>Current Stage</label>
                <input type="text" class="q-input" value="${batch.currentStage}" disabled>
            </div>

            <div class="q-form-group">
                <label>Move to Stage <span class="q-required">*</span></label>
                <select id="newStage" class="q-input" onchange="updateStagePercentageModal()">
                    ${stages.map((stage, idx) => `
                        <option value="${stage}" ${idx === currentIndex ? 'selected' : ''}>${stage}</option>
                    `).join('')}
                </select>
            </div>

            <div class="q-form-group">
                <label>Progress % <span class="q-required">*</span></label>
                <input type="text" id="progressPercent" class="q-input" value="${batch.progress}" readonly disabled style="background: #f9f9f9; font-weight: 600;">
            </div>

            <div class="q-form-group">
                <label>Notes (Optional)</label>
                <textarea id="batchNotes" class="q-textarea" placeholder="Production notes..." style="height: 80px;">${batch.notes || ''}</textarea>
            </div>

            <div class="q-form-actions">
                <button class="q-btn q-btn-secondary" onclick="closeModal()">Cancel</button>
                <button class="q-btn q-btn-primary" onclick="updateBatchStage('${batchId}')">Update Stage</button>
            </div>
        </div>
    `;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>Update Batch Stage</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                ${modalContent}
            </div>
        </div>
    `;

    const modalContainer = document.getElementById('modalContainer');
    modalContainer.innerHTML = '';
    modalContainer.appendChild(modal);

    // Initialize progress percentage
    updateStagePercentageModal();
}

// Update Batch Stage
// Auto-update percentage based on selected stage
function updateStagePercentage() {
    const stageSelect = document.getElementById('newStage');
    const progressInput = document.getElementById('progressPercent');
    const stageToProgress = {
        'Designing': 25,
        'Cutting': 50,
        'Sewing': 75,
        'Completed': 100
    };
    if (stageSelect && progressInput) {
        progressInput.value = stageToProgress[stageSelect.value] || 0;
    }
}

// Auto-update percentage based on selected stage (for modal version)
function updateStagePercentageModal() {
    const stageSelect = document.getElementById('newStage');
    const progressInput = document.getElementById('progressPercent');
    const stageToProgress = {
        'Designing': 25,
        'Cutting': 50,
        'Sewing': 75,
        'Completed': 100
    };
    if (stageSelect && progressInput) {
        progressInput.value = stageToProgress[stageSelect.value] || 0;
    }
}

async function updateBatchStage(batchId) {
    showLoading('Updating batch stage...');
    try {
        const batch = AppState.productions.find(p => p.batchId === batchId);
        if (!batch) {
            hideLoading();
            showMessage('Error', 'Batch not found', 'error');
            return;
        }

        const newStage = document.getElementById('newStage')?.value;
        const progressPercent = document.getElementById('progressPercent')?.value;
        const notes = document.getElementById('batchNotes')?.value;

        if (!newStage) {
            hideLoading();
            showMessage('Required Fields', 'Please select a stage', 'warning');
            return;
        }

        batch.currentStage = newStage;
        batch.progress = parseInt(progressPercent) || 0;
        batch.notes = notes;
        batch.lastUpdated = new Date().toLocaleDateString();

        // Update related job order status and stage
        const jobToUpdate = AppState.jobOrders.find(j => j.jobId === batch.jobId);
        if (jobToUpdate) {
            jobToUpdate.stage = newStage;
            jobToUpdate.progress = parseInt(progressPercent) || 0;
        }

        // Update related order status based on batch stage
        if (batch.jobOrderRef || batch.orderRef) {
            const order = AppState.orders.find(o => o.orderId === batch.jobOrderRef || o.orderId === batch.orderRef);
            if (order) {
                // Only set to in_production; do not mark as completed (only delivery completion should do that)
                if (newStage !== 'Completed') order.status = 'in_production';
            }
        }

        await syncDataToFirestore();
        hideLoading();
        closeModal();
        loadProductionContent();
        updateDashboardStats();
        showMessage('Success', 'Batch stage updated successfully!', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error updating batch:', error);
        showMessage('Error', 'Failed to update batch: ' + error.message, 'error');
    }
}

// Complete Batch Production
function confirmCompleteBatchProduction(batchId) {
    const batch = AppState.productions.find(p => p.batchId === batchId);
    if (!batch) return;
    const modal = createModal('Complete Batch Production', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Mark batch <strong>${batchId}</strong> as completed?</p>
            <p style="margin-bottom: 0.5rem; color: #666; font-size: 0.9rem;">Garment: ${batch.garmentType}</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">Quantity: ${batch.quantity} units</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="completeBatchProductionConfirmed('${batchId}')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Complete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function completeBatchProductionConfirmed(batchId) {
    showLoading('Completing batch...');
    try {
        const batch = AppState.productions.find(p => p.batchId === batchId);
        if (!batch) return;

        batch.status = 'completed';
        batch.progress = 100;
        batch.currentStage = 'Completed';
        batch.completionDate = new Date().toLocaleDateString();

        // Update related job order status to completed
        const completedJob = AppState.jobOrders.find(j => j.jobId === batch.jobId);
        if (completedJob) {
            completedJob.status = 'completed';
            completedJob.stage = 'Completed';
            completedJob.progress = 100;
        }

        // Update related order status to production_complete
        if (batch.jobOrderRef || batch.orderRef) {
            const order = AppState.orders.find(o => o.orderId === batch.jobOrderRef || o.orderId === batch.orderRef);
            if (order) {
                order.status = 'production_complete';
            }
        }

        await syncDataToFirestore();
        hideLoading();
        closeModal();
        loadProductionContent();
        renderInventoryTabs();
        // Also refresh the Inventory Catalog so produced items appear there immediately
        if (typeof renderOrderCatalog === 'function') renderOrderCatalog();
        if (typeof updateOrderStats === 'function') updateOrderStats();
        updateDashboardStats();
        showMessage('Success', 'Batch ' + batchId + ' marked as completed. Items will be added to inventory after QC inspection.', 'success');
    } catch (error) {
        hideLoading();
        showMessage('Error', 'Failed to complete batch: ' + error.message, 'error');
    }
}

async function completeBatchProduction(batchId) {
    confirmCompleteBatchProduction(batchId);
}

// Open QC Inspection Modal
function openQCInspectionModal(batchId) {
    const batch = AppState.productions.find(p => p.batchId === batchId);
    if (!batch) return;

    const modalContent = `
        <div class="quotation-form-section">
            <div class="q-section-header">
                <h2>Quality Control Inspection</h2>
                <p>Batch: ${batch.batchId} | Quantity: ${batch.quantity} pcs</p>
            </div>

            <div class="q-form-group">
                <label>Inspector Name <span class="q-required">*</span></label>
                <select id="qcInspector" class="q-input">
                    <option value="">-- Select QC Inspector --</option>
                </select>
            </div>

            <div class="q-form-group">
                <label style="display: block; margin-bottom: 1rem;">Inspection Checklist</label>
                <div style="background: white; padding: 1rem; border-radius: 8px; border: 1px solid #E0E0E0;">
                    <label style="display: flex; gap: 0.75rem; margin-bottom: 0.75rem;">
                        <input type="checkbox" id="qcCheck1" class="qc-check"> <span>Garment dimensions match specifications</span>
                    </label>
                    <label style="display: flex; gap: 0.75rem; margin-bottom: 0.75rem;">
                        <input type="checkbox" id="qcCheck2" class="qc-check"> <span>Stitching quality is acceptable</span>
                    </label>
                    <label style="display: flex; gap: 0.75rem; margin-bottom: 0.75rem;">
                        <input type="checkbox" id="qcCheck3" class="qc-check"> <span>Colors match design specifications</span>
                    </label>
                    <label style="display: flex; gap: 0.75rem; margin-bottom: 0.75rem;">
                        <input type="checkbox" id="qcCheck4" class="qc-check"> <span>No visible defects or damage</span>
                    </label>
                    <!-- Packaging check removed from QC checklist -->
                </div>
            </div>

            <div class="q-form-group">
                <label>Defects Found (if any)</label>
                <textarea id="qcDefects" class="q-textarea" placeholder="List any defects or issues..." style="height: 80px;"></textarea>
            </div>

            <div class="q-form-group">
                <label>Inspection Result <span class="q-required">*</span></label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <label style="padding: 1rem; border: 2px solid #E0E0E0; border-radius: 8px; text-align: center; cursor: pointer;">
                        <input type="radio" name="qcResult" value="passed"> <span style="display: block; font-weight: 600; color: #27AE60;">✅ PASSED</span>
                    </label>
                    <label style="padding: 1rem; border: 2px solid #E0E0E0; border-radius: 8px; text-align: center; cursor: pointer;">
                        <input type="radio" name="qcResult" value="failed"> <span style="display: block; font-weight: 600; color: #E74C3C;">❌ FAILED</span>
                    </label>
                </div>
            </div>

            <div class="q-form-actions">
                <button class="q-btn q-btn-secondary" onclick="closeModal()">Cancel</button>
                <button class="q-btn q-btn-primary" onclick="submitQCInspection('${batchId}')">Submit Inspection</button>
            </div>
        </div>
    `;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>QC Inspection Form</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                ${modalContent}
            </div>
        </div>
    `;

    const modalContainer = document.getElementById('modalContainer');
    modalContainer.innerHTML = '';
    modalContainer.appendChild(modal);

    // Populate employee dropdowns after modal is added to DOM
    populateEmployeeDropdown('qcInspector', 'Quality Inspector');
}
// Submit QC Inspection Result
async function submitQCInspection(batchId) {
    showLoading('Processing QC inspection...');
    try {
        const batch = AppState.productions.find(p => p.batchId === batchId);
        if (!batch) {
            hideLoading();
            showMessage('Error', 'Batch not found', 'error');
            return;
        }

        const inspector = document.getElementById('qcInspector')?.value;
        const defects = document.getElementById('qcDefects')?.value;
        const result = document.querySelector('input[name="qcResult"]:checked')?.value;

        if (!inspector || !result) {
            hideLoading();
            showMessage('Required Fields', 'Please fill in inspector name and inspection result', 'warning');
            return;
        }

        batch.assignedInspector = inspector;
        batch.inspectionDate = new Date().toLocaleDateString();
        batch.qcStatus = result;
        batch.qcDefects = defects;

        // If QC passed, add produced items to inventory catalog
        if (result === 'passed') {
            try {
                const producedSku = `PROD-${batch.batchId}`;
                const existing = (AppState.inventoryCatalogItems || []).find(i => i.sku === producedSku);
                if (existing) {
                    existing.quantity = (existing.quantity || 0) + (batch.quantity || 0);
                } else {
                    // Attempt to attach an image from the related order's design files
                    let attachedImage = null;
                    let relatedOrder = null;
                    try {
                        relatedOrder = AppState.orders.find(o => o.orderId === batch.orderRef || o.orderId === batch.jobOrderRef) || null;
                        const files = relatedOrder?.files || [];
                        const imgFile = files.find(f => /image\/(png|jpg|jpeg|gif|webp)/i.test(f.type));
                        if (imgFile) attachedImage = imgFile.data;
                    } catch (e) {
                        // ignore
                    }

                    // Determine unit price: prefer batch.unitPrice, fallback to order quoted amount / quantity
                    let computedUnitPrice = batch.unitPrice;
                    try {
                        if (!computedUnitPrice && relatedOrder && typeof relatedOrder.quotedAmount === 'number' && relatedOrder.quantity) {
                            computedUnitPrice = (relatedOrder.quotedAmount || 0) / (relatedOrder.quantity || 1);
                        }
                    } catch (e) {
                        computedUnitPrice = computedUnitPrice || 0;
                    }

                    const newInv = {
                        sku: producedSku,
                        name: `${batch.garmentType} - ${batch.batchId}`,
                        category: 'Finished Goods',
                        quantity: batch.quantity || 0,
                        minStock: 0,
                        unit: 'pieces',
                        source: 'production',
                        unitPrice: computedUnitPrice || 0,
                        supplier: batch.createdBy || 'production',
                        description: `Produced from batch ${batch.batchId}`,
                        orderCustomer: relatedOrder?.customerName || null,
                        image: attachedImage || null,
                        addedDate: new Date().toLocaleDateString(),
                        addedBy: AppState.currentUser?.username || 'system'
                    };
                    AppState.inventoryCatalogItems.push(newInv);
                }
            } catch (e) {
                console.error('Error adding batch to inventory catalog after QC pass', e);
            }


        }

        await syncDataToFirestore();
        hideLoading();
        closeModal();
        loadProductionContent();
        updateDashboardStats();
        const message = result === 'passed' ? 'Batch PASSED QC inspection ✅' : 'Batch FAILED QC inspection - needs rework ❌';
        showMessage('Success', message, 'success');
        // If QC passed, it will now appear in the "Generate Receipts" section for manual generation
        if (result === 'passed') {
            try {
                showMessage('Info', 'Batch passed QC — use Generate Receipts tab to create production receipt.', 'info');
            } catch (e) {
                console.warn('Receipt notification failed', e);
            }
        }
    } catch (error) {
        hideLoading();
        console.error('Error submitting QC inspection:', error);
        showMessage('Error', 'Failed to submit inspection: ' + error.message, 'error');
    }
}

// Send a failed batch back to production for rework and notify assignees
async function sendBatchToRework(batchId) {
    showLoading('Sending batch to rework...');
    try {
        const batch = AppState.productions.find(p => p.batchId === batchId);
        if (!batch) {
            hideLoading();
            showMessage('Error', 'Batch not found', 'error');
            return;
        }

        // Move back to production
        batch.status = 'in_production';
        batch.currentStage = batch.currentStage && batch.currentStage !== 'Completed' ? batch.currentStage : 'Stitching';
        batch.progress = Math.min(batch.progress || 0, 50);
        // Reset QC fields so it becomes pending again
        batch.qcStatus = 'pending';
        batch.assignedInspector = batch.assignedInspector || null;
        batch.inspectionDate = null;

        // Update related order status to in_production so it appears in active batches
        if (batch.jobOrderRef || batch.orderRef) {
            const order = AppState.orders.find(o => o.orderId === batch.jobOrderRef || o.orderId === batch.orderRef);
            if (order) order.status = 'in_production';
        }

        await syncDataToFirestore();
        hideLoading();
        loadProductionContent();
        updateProductionStats();
        showMessage('Success', `Batch ${batchId} returned to Active Batches for rework`, 'success');
    } catch (error) {
        hideLoading();
        console.error('Error sending batch to rework:', error);
        showMessage('Error', 'Failed to send batch to rework: ' + error.message, 'error');
    }
}

// View Batch Details
function viewBatchDetails(batchId) {
    const batch = AppState.productions.find(p => p.batchId === batchId);
    if (!batch) return;

    // Define workflow stages with fixed percentages
    const workflowStages = [
        { id: 'designing', label: 'Designing', progress: 25 },
        { id: 'cutting', label: 'Cutting', progress: 50 },
        { id: 'sewing', label: 'Sewing', progress: 75 },
        { id: 'completed', label: 'Completed', progress: 100 }
    ];

    // Create progress to stage mapping
    const stageProgressMap = {};
    workflowStages.forEach(stage => {
        stageProgressMap[stage.id] = stage.progress;
    });

    // Get current progress to determine active stage
    const currentProgress = batch.progress || 0;
    const currentStageId = batch.currentStage ? batch.currentStage.toLowerCase().replace(/\s+/g, '_') : 'designing';

    // Build workflow HTML
    let workflowHTML = '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin: 2rem 0;">';

    workflowStages.forEach(stage => {
        let stageStatus = 'pending';

        if (currentProgress >= stage.progress) {
            stageStatus = 'completed';
        } else if (currentStageId.includes(stage.id) || currentProgress > (stage.progress - 25)) {
            stageStatus = 'in-progress';
        }

        const statusStyle = stageStatus === 'completed' ? 'background: #E8F8F5; border: 2px solid #27AE60; color: #27AE60;' :
            stageStatus === 'in-progress' ? 'background: #FFF4E5; border: 2px solid #F39C12; color: #F39C12;' :
                'background: #F5F5F5; border: 2px solid #ccc; color: #999;';

        const icon = stageStatus === 'completed' ? '✅' : stageStatus === 'in-progress' ? '⚙️' : '⭕';

        workflowHTML += `
            <div style="padding: 1rem; border-radius: 8px; text-align: center; ${statusStyle}">
                <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">${icon}</div>
                <div style="font-weight: 600; font-size: 0.9rem;">${stage.label}</div>
                <div style="font-size: 0.85rem; margin-top: 0.5rem; opacity: 0.8;">${stage.progress}%</div>
            </div>
        `;
    });

    workflowHTML += '</div>';

    const details = `
        <div class="quotation-form-section">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem;">
                <div>
                    <h3 style="font-size: 1.1rem; color: var(--navy-dark); margin-bottom: 1rem;">Batch Information</h3>
                    <p><strong>Batch ID:</strong> ${batch.batchId}</p>
                    <p><strong>Order Reference:</strong> ${batch.orderRef}</p>
                    <p><strong>Garment Type:</strong> ${batch.garmentType}</p>
                    <p><strong>Quantity:</strong> ${batch.quantity} pcs</p>
                    <p><strong>Status:</strong> ${formatStatus(batch.status)}</p>
                </div>
                <div>
                    <h3 style="font-size: 1.1rem; color: var(--navy-dark); margin-bottom: 1rem;">Production Details</h3>
                    <p><strong>Current Stage:</strong> ${formatStatus(batch.currentStage)}</p>
                    <p><strong>Progress:</strong> <span style="font-weight: 700; color: #D4AF37; font-size: 1.2rem;">${batch.progress}%</span></p>
                    <p><strong>Assigned Worker:</strong> ${batch.assignedWorker}</p>
                    <p><strong>Created:</strong> ${batch.createdDate}</p>
                    <p><strong>Completed:</strong> ${batch.completionDate || 'In Progress'}</p>
                </div>
            </div>
            
            <div style="padding: 2rem; background: #FFF9F0; border-radius: 8px; border: 1px solid #F0E6D2; margin-bottom: 2rem;">
                <h3 style="font-size: 1.1rem; color: var(--navy-dark); margin-bottom: 1rem;">Production Workflow</h3>
                ${workflowHTML}
                <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #E0D5C7;">
                    <p style="font-size: 0.9rem; color: #666; text-align: center;">
                        <span style="display: inline-block; margin: 0 0.75rem;">📊 Stages progress with production advances</span>
                    </p>
                </div>
            </div>
            
            <div style="margin-top: 2rem; padding-top: 2rem; border-top: 2px solid var(--border-light);">
                <h3 style="font-size: 1.1rem; color: var(--navy-dark); margin-bottom: 1rem;">Update Stage</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; color: #666; font-size: 0.9rem; font-weight: 500;">Stage</label>
                        <select id="newStage" onchange="updateStagePercentage()" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;">
                            <option value="Designing">Designing</option>
                            <option value="Cutting">Cutting</option>
                            <option value="Sewing">Sewing</option>
                            <option value="Completed">Completed</option>
                        </select>
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; color: #666; font-size: 0.9rem; font-weight: 500;">Progress (%)</label>
                        <input type="text" id="progressPercent" readonly value="${batch.progress}" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9; font-weight: 600;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; color: #666; font-size: 0.9rem; font-weight: 500;">&nbsp;</label>
                        <button onclick="updateBatchStage('${batch.batchId}')" style="width: 100%; padding: 0.5rem; background: #D4AF37; color: var(--navy-dark); border: none; border-radius: 4px; font-weight: 600; cursor: pointer;">Update</button>
                    </div>
                </div>
                <div>
                    <label style="display: block; margin-bottom: 0.5rem; color: #666; font-size: 0.9rem; font-weight: 500;">Notes</label>
                    <textarea id="batchNotes" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; min-height: 80px;">${batch.notes || ''}</textarea>
                </div>
            </div>
        </div>
    `;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>Batch Details - ${batch.batchId}</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                ${details}
            </div>
        </div>
    `;

    const modalContainer = document.getElementById('modalContainer');
    modalContainer.innerHTML = '';
    modalContainer.appendChild(modal);
}

// Generate a production receipt for a finished batch (stores in billings and opens print preview)
async function generateReceiptForBatch(batchId) {
    showLoading('Generating receipt...');
    try {
        const batch = AppState.productions.find(p => p.batchId === batchId);
        if (!batch) {
            hideLoading();
            showMessage('Error', 'Batch not found for receipt generation', 'error');
            return;
        }

        const order = AppState.orders.find(o => o.orderId === batch.orderRef || o.orderId === batch.jobOrderRef) || {};

        // Build items array
        const unitPrice = batch.unitPrice || (order.quotedAmount && order.quantity ? (order.quotedAmount / order.quantity) : 0);
        const qty = batch.quantity || order.quantity || 0;
        const subtotal = (unitPrice || 0) * (qty || 0);
        const taxRate = 0; // configurable later
        const tax = subtotal * taxRate;
        const total = subtotal + tax;

        // Receipt numbering: REC - YYYY - ####
        const year = new Date().getFullYear();
        let maxRec = 0;
        (AppState.billings || []).forEach(b => {
            const m = (b.receiptId || b.invoiceId || '').match(/REC\s*-\s*\d+\s*-\s*(\d+)/);
            if (m) maxRec = Math.max(maxRec, parseInt(m[1]));
        });
        const nextRec = String((maxRec || 0) + 1).padStart(4, '0');
        const receiptId = `REC - ${year} - ${nextRec}`;

        const receipt = {
            receiptId,
            date: new Date().toLocaleDateString(),
            dateISO: new Date().toISOString(),
            batchId: batch.batchId,
            orderRef: batch.orderRef || null,
            customerName: order.customerName || '',
            customerAddress: order.deliveryAddress || order.address || '',
            items: [
                {
                    description: batch.garmentType || order.garmentType || 'Finished Goods',
                    quantity: qty,
                    unitPrice: Number((unitPrice || 0).toFixed(2)),
                    subtotal: Number(subtotal.toFixed(2))
                }
            ],
            subtotal: Number(subtotal.toFixed(2)),
            tax: Number(tax.toFixed(2)),
            total: Number(total.toFixed(2)),
            createdBy: AppState.currentUser?.username || 'system',
            type: 'production_receipt',
            status: 'issued'
        };

        // Save to AppState.billings for record (will be synced by syncDataToFirestore)
        AppState.billings = AppState.billings || [];
        AppState.billings.push(receipt);
        await syncDataToFirestore();

        // Build printable HTML
        const companyName = 'GoldenThreads IMS';
        const addr = 'Company Address';
        let itemsHtml = receipt.items.map(it => `
                <tr>
                        <td style="padding:8px;border:1px solid #ddd;">${it.description}</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${it.quantity}</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${it.unitPrice.toFixed(2)}</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${it.subtotal.toFixed(2)}</td>
                </tr>`).join('');

        const html = `
        <div style="font-family: Arial, serif; max-width:800px; margin:0 auto;">
            <h2 style="margin-bottom:0;">${companyName}</h2>
            <p style="margin-top:4px;color:#666;">${addr}</p>
            <hr>
            <h3>Production Receipt</h3>
            <p><strong>Receipt ID:</strong> ${receipt.receiptId}</p>
            <p><strong>Date:</strong> ${receipt.date}</p>
            <p><strong>Batch ID:</strong> ${receipt.batchId}</p>
            <p><strong>Order Ref:</strong> ${receipt.orderRef || '-'}</p>
            <p><strong>Customer:</strong> ${receipt.customerName || '-'}</p>
            <p><strong>Delivery Address:</strong> ${receipt.customerAddress || '-'}</p>
            <table style="width:100%;border-collapse:collapse;margin-top:12px;">
                <thead>
                    <tr>
                        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Description</th>
                        <th style="padding:8px;border:1px solid #ddd;text-align:right;">Qty</th>
                        <th style="padding:8px;border:1px solid #ddd;text-align:right;">Unit</th>
                        <th style="padding:8px;border:1px solid #ddd;text-align:right;">Subtotal</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" style="padding:8px;border:1px solid #ddd;text-align:right;">Subtotal</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${receipt.subtotal.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td colspan="3" style="padding:8px;border:1px solid #ddd;text-align:right;">Tax</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${receipt.tax.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td colspan="3" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">Total</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">₱${receipt.total.toFixed(2)}</td>
                    </tr>
                </tfoot>
            </table>
            <p style="margin-top:18px;color:#666;">Produced by: ${receipt.createdBy}</p>
            <p style="color:#666;">Inspector: ${batch.assignedInspector || '-'}</p>
        </div>`;

        hideLoading();
        printReceipt(html);
        showMessage('Success', `Production Receipt ${receipt.receiptId} generated`, 'success');
    } catch (error) {
        hideLoading();
        console.error('Error generating receipt:', error);
        showMessage('Error', 'Failed to generate receipt: ' + error.message, 'error');
    }
}

// Opens a print preview window for provided HTML and triggers print
function printReceipt(innerHtml) {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) {
        showMessage('Error', 'Unable to open print window. Check popup blocker.', 'error');
        return;
    }
    const html = `
        <html>
            <head>
                <title>Print Receipt</title>
                <style>body{font-family: Arial, sans-serif; padding:20px;} table{border-collapse:collapse;} th,td{border:1px solid #ddd;padding:8px;} th{background:#f5f5f5}</style>
            </head>
            <body>
                ${innerHtml}
            </body>
        </html>`;
    w.document.write(html);
    w.document.close();
    // Use setTimeout to ensure window is fully loaded before printing
    setTimeout(() => {
        try {
            w.print();
        } catch (e) {
            console.error('Print error:', e);
        }
    }, 500);
}

// Show a modal with receipt preview and Generate/Print actions (does NOT auto-create until user confirms)
function showGenerateReceiptModal(batchId) {
    const batch = AppState.productions.find(p => p.batchId === batchId);
    if (!batch) return showMessage('Error', 'Batch not found', 'error');
    const order = AppState.orders.find(o => o.orderId === batch.orderRef || o.orderId === batch.jobOrderRef) || {};

    const unitPrice = batch.unitPrice || (order.quotedAmount && order.quantity ? (order.quotedAmount / order.quantity) : 0);
    const qty = batch.quantity || order.quantity || 0;
    const subtotal = (unitPrice || 0) * (qty || 0);

    const itemsHtml = `
        <tr>
            <td style="padding:8px;border:1px solid #ddd;">${batch.garmentType || order.garmentType || 'Finished Goods'}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">${qty}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${(unitPrice || 0).toFixed(2)}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${subtotal.toFixed(2)}</td>
        </tr>`;

    const content = `
        <div style="padding:1rem;max-height:70vh;overflow:auto;">
            <h3 style="margin-top:0;">Generate Production Receipt</h3>
            <p><strong>Batch:</strong> ${batch.batchId}</p>
            <p><strong>Order:</strong> ${order.orderId || '-'} &nbsp; <strong>Customer:</strong> ${order.customerName || '-'}</p>
            <table style="width:100%;border-collapse:collapse;margin-top:12px;">
                <thead>
                    <tr>
                        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Description</th>
                        <th style="padding:8px;border:1px solid #ddd;text-align:right;">Qty</th>
                        <th style="padding:8px;border:1px solid #ddd;text-align:right;">Unit</th>
                        <th style="padding:8px;border:1px solid #ddd;text-align:right;">Subtotal</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" style="padding:8px;border:1px solid #ddd;text-align:right;">Subtotal</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${subtotal.toFixed(2)}</td>
                    </tr>
                </tfoot>
            </table>
            <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:12px;">
                <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button class="btn btn-primary" id="generateReceiptBtn" onclick="(async function(){
                    showLoading('Generating receipt...');
                    const btn = document.getElementById('generateReceiptBtn');
                    btn.disabled = true; btn.textContent = 'Generating...';
                    try { await generateReceiptForBatch('${batchId}'); hideLoading(); closeModal(); } catch (e) { hideLoading(); console.error(e); showMessage('Error', 'Failed to generate receipt: '+e.message, 'error'); }
                })()">Generate Receipt</button>
            </div>
        </div>
    `;

    const modal = createLargeModal('Generate Receipt', content);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function loadBillingContent() {
    const contentArea = document.getElementById('contentArea');

    // Calculate filtered badge counts
    const pendingInvoicesCount = (AppState.billings || []).filter(inv => inv.type !== 'production_receipt' && inv.status !== 'paid').length;
    const pendingDeliveriesCount = (AppState.deliveries || []).filter(d => {
        if (d.status === 'delivered') return false;
        const order = AppState.orders.find(o => o.orderId === d.orderRef);
        return !order || order.deliveryType === 'for_delivery' || !order.deliveryType;
    }).length;
    const deliveredCount = (AppState.deliveries || [])
        .filter(d => d.status === 'delivered')
        .filter(d => (AppState.billings || []).some(b => b.invoiceId === d.invoiceRef && b.status === 'paid'))
        .length;
    const pendingPickupsCount = (AppState.orders || []).filter(o =>
        o.deliveryType === 'for_pickup' && o.status === 'ready_for_pickup'
    ).length;
    const pickedUpCount = (AppState.orders || []).filter(o =>
        o.deliveryType === 'for_pickup' && o.status === 'completed' && o.pickupDate
    ).length;
    const receiptsCount = (AppState.billings || []).filter(b => b.type === 'production_receipt').length;

    contentArea.innerHTML = `
        <div style="padding: 0;">
            <!-- Main Stats Grid -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-bottom: 32px;">
                <div class="billing-stat-card active" data-section="invoices" onclick="switchBillingStatSection('invoices')" style="background: white; border-radius: 16px; padding: 14px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); transition: all 0.3s; cursor: pointer; position: relative; overflow: hidden; border: 2px solid transparent; display: flex; align-items: center; gap: 12px;">
                    <svg style="width: 24px; height: 24px; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    <span style="font-size: 14px; font-weight: 600; color: #576F72; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0;">Invoices</span>
                    <div style="font-size: 16px; font-weight: 700; color: #2C3639; font-family: 'Playfair Display', serif;">${pendingInvoicesCount}</div>
                </div>

                <div class="billing-stat-card" data-section="deliveries" onclick="switchBillingStatSection('deliveries')" style="background: white; border-radius: 16px; padding: 14px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); transition: all 0.3s; cursor: pointer; position: relative; overflow: hidden; border: 2px solid transparent; display: flex; align-items: center; gap: 12px;">
                    <svg style="width: 24px; height: 24px; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/>
                    </svg>
                    <span style="font-size: 14px; font-weight: 600; color: #576F72; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0;">Deliveries</span>
                    <div style="font-size: 16px; font-weight: 700; color: #2C3639; font-family: 'Playfair Display', serif;">${pendingDeliveriesCount}</div>
                </div>

                <div class="billing-stat-card" data-section="delivered" onclick="switchBillingStatSection('delivered')" style="background: white; border-radius: 16px; padding: 14px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); transition: all 0.3s; cursor: pointer; position: relative; overflow: hidden; border: 2px solid transparent; display: flex; align-items: center; gap: 12px;">
                    <svg style="width: 24px; height: 24px; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <span style="font-size: 14px; font-weight: 600; color: #576F72; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0;">Delivered</span>
                    <div style="font-size: 16px; font-weight: 700; color: #2C3639; font-family: 'Playfair Display', serif;">${deliveredCount}</div>
                </div>
            </div>

            <!-- Sub Stats Grid -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-bottom: 40px;">
                <div class="billing-sub-stat-card" data-section="receipts" onclick="switchBillingStatSection('receipts')" style="background: white; border-radius: 16px; padding: 14px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); transition: all 0.3s; cursor: pointer; border: 2px solid transparent; display: flex; align-items: center; gap: 12px;">
                    <svg style="width: 24px; height: 24px; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    <span style="font-size: 14px; font-weight: 600; color: #576F72; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0;">Receipts</span>
                    <div style="font-size: 16px; font-weight: 700; color: #2C3639; font-family: 'Playfair Display', serif;">${receiptsCount}</div>
                </div>

                <div class="billing-sub-stat-card" data-section="pickups" onclick="switchBillingStatSection('pickups')" style="background: white; border-radius: 16px; padding: 14px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); transition: all 0.3s; cursor: pointer; border: 2px solid transparent; display: flex; align-items: center; gap: 12px;">
                    <svg style="width: 24px; height: 24px; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
                    </svg>
                    <span style="font-size: 14px; font-weight: 600; color: #576F72; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0;">Pickups</span>
                    <div style="font-size: 16px; font-weight: 700; color: #2C3639; font-family: 'Playfair Display', serif;">${pendingPickupsCount}</div>
                </div>

                <div class="billing-sub-stat-card" data-section="picked_up" onclick="switchBillingStatSection('picked_up')" style="background: white; border-radius: 16px; padding: 14px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); transition: all 0.3s; cursor: pointer; border: 2px solid transparent; display: flex; align-items: center; gap: 12px;">
                    <svg style="width: 24px; height: 24px; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                    </svg>
                    <span style="font-size: 14px; font-weight: 600; color: #576F72; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0;">Picked Up</span>
                    <div style="font-size: 16px; font-weight: 700; color: #2C3639; font-family: 'Playfair Display', serif;">${pickedUpCount}</div>
                </div>
            </div>

            <!-- Invoices Section -->
            <div id="invoices-section" class="billing-section" style="background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); margin-bottom: 32px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid #F0EBE3;">
                    <div>
                        <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #2C3639; letter-spacing: -0.5px; margin-bottom: 6px;">Invoices</h2>
                        <p style="color: #576F72; font-size: 14px; font-style: italic;">Create and manage invoices and payments</p>
                    </div>
                    <button onclick="openCreateInvoiceModal()" style="padding: 12px 24px; background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3);">
                        <span>+</span> New Invoice
                    </button>
                </div>

                <div style="overflow-x: auto; border-radius: 12px; border: 1px solid #F0EBE3;">
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead style="background: #2C3639; color: #FAF7F0;">
                            <tr>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Invoice ID</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Order Ref</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Customer</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Amount</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Due Date</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Status</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="invoicesTableBody">
                            <tr style="border-bottom: 1px solid #F0EBE3;"><td colspan="7" style="padding: 2rem; text-align: center; color: #576F72;">No invoices found. Create one to bill a customer.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Deliveries Section -->
            <div id="deliveries-section" class="billing-section" style="display: none; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); margin-bottom: 32px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid #F0EBE3;">
                    <div>
                        <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #2C3639; letter-spacing: -0.5px; margin-bottom: 6px;">Deliveries</h2>
                        <p style="color: #576F72; font-size: 14px; font-style: italic;">Track deliveries and delivery statuses</p>
                    </div>
                    <button onclick="openCreateDeliveryModal()" style="padding: 12px 24px; background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3);">
                        <span>+</span> New Delivery
                    </button>
                </div>

                <div style="overflow-x: auto; border-radius: 12px; border: 1px solid #F0EBE3;">
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead style="background: #2C3639; color: #FAF7F0;">
                            <tr>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Delivery ID</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Invoice Ref</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Order Ref</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Customer</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Assigned To</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Status</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="deliveriesTableBody">
                            <tr style="border-bottom: 1px solid #F0EBE3;"><td colspan="7" style="padding: 2rem; text-align: center; color: #576F72;">No deliveries scheduled.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Delivered Section -->
            <div id="delivered-section" class="billing-section" style="display: none; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); margin-bottom: 32px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid #F0EBE3;">
                    <div>
                        <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #2C3639; letter-spacing: -0.5px; margin-bottom: 6px;">Delivered Orders</h2>
                        <p style="color: #576F72; font-size: 14px; font-style: italic;">Orders that have been paid and delivered</p>
                    </div>
                </div>

                <div style="overflow-x: auto; border-radius: 12px; border: 1px solid #F0EBE3;">
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead style="background: #2C3639; color: #FAF7F0;">
                            <tr>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Order ID</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Invoice ID</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Customer</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Amount</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Delivery Date</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Status</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="deliveredTableBody">
                            <tr style="border-bottom: 1px solid #F0EBE3;"><td colspan="7" style="padding: 2rem; text-align: center; color: #576F72;">No delivered and paid orders.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Receipts Section -->
            <div id="receipts-section" class="billing-section" style="display: none; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); margin-bottom: 32px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid #F0EBE3;">
                    <div>
                        <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #2C3639; letter-spacing: -0.5px; margin-bottom: 6px;">Receipts</h2>
                        <p style="color: #576F72; font-size: 14px; font-style: italic;">Production receipts generated after QC</p>
                    </div>
                    <button onclick="renderReceiptsTable()" style="padding: 10px 20px; background: white; color: #2C3639; border: 2px solid #D4AF37; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.3s;">REFRESH</button>
                </div>

                <div style="display: flex; gap: 16px; margin-bottom: 24px; align-items: center;">
                    <div style="flex: 1;">
                        <input id="receipts_search" type="text" placeholder="Search by Receipt ID, Order, or Customer" style="width: 100%; padding: 14px 20px; border: 2px solid #F0EBE3; border-radius: 10px; font-size: 14px; font-family: 'DM Sans', sans-serif; transition: all 0.3s; background: #FAF7F0;">
                    </div>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <input id="receipts_from" type="date" style="padding: 12px 16px; border: 2px solid #F0EBE3; border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif; transition: all 0.3s; background: #FAF7F0;">
                        <input id="receipts_to" type="date" style="padding: 12px 16px; border: 2px solid #F0EBE3; border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif; transition: all 0.3s; background: #FAF7F0;">
                        <button onclick="renderReceiptsTable()" style="padding: 12px 24px; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.3s; background: #D4AF37; color: #2C3639;">FILTER</button>
                        <button onclick="clearReceiptsFilters()" style="padding: 12px 24px; background: transparent; color: #576F72; border: 2px solid #F0EBE3; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.3s;">CLEAR</button>
                    </div>
                </div>

                <div style="overflow-x: auto; border-radius: 12px; border: 1px solid #F0EBE3;">
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead style="background: #2C3639; color: #FAF7F0;">
                            <tr>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Receipt ID</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Date</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Batch ID</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Order Ref</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Customer</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Total</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="receiptsTableBody">
                            <tr style="border-bottom: 1px solid #F0EBE3;"><td colspan="7" style="padding: 2rem; text-align: center; color: #576F72;">No receipts found.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Pickups Section -->
            <div id="pickups-section" class="billing-section" style="display: none; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); margin-bottom: 32px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid #F0EBE3;">
                    <div>
                        <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #2C3639; letter-spacing: -0.5px; margin-bottom: 6px;">Pickups</h2>
                        <p style="color: #576F72; font-size: 14px; font-style: italic;">Orders ready for customer pickup at warehouse</p>
                    </div>
                    <button onclick="openCreatePickupModal()" style="padding: 12px 24px; background: linear-gradient(135deg, #D4AF37, #B8941E); color: white; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3);">
                        <span>+</span> New Pickup
                    </button>
                </div>

                <div style="overflow-x: auto; border-radius: 12px; border: 1px solid #F0EBE3;">
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead style="background: #2C3639; color: #FAF7F0;">
                            <tr>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Order ID</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Customer</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Garment Type</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Quantity</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Invoice</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Status</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="pickupsTableBody">
                            <tr style="border-bottom: 1px solid #F0EBE3;"><td colspan="7" style="padding: 2rem; text-align: center; color: #576F72;">No orders pending pickup.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Picked Up Section -->
            <div id="picked_up-section" class="billing-section" style="display: none; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 16px rgba(44, 54, 57, 0.08); margin-bottom: 32px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid #F0EBE3;">
                    <div>
                        <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #2C3639; letter-spacing: -0.5px; margin-bottom: 6px;">Picked Up Orders</h2>
                        <p style="color: #576F72; font-size: 14px; font-style: italic;">Orders that have been picked up from warehouse</p>
                    </div>
                </div>

                <div style="overflow-x: auto; border-radius: 12px; border: 1px solid #F0EBE3;">
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead style="background: #2C3639; color: #FAF7F0;">
                            <tr>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Order ID</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Customer</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Garment Type</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Quantity</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Pickup Date</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Status</th>
                                <th style="padding: 18px 20px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 3px solid #D4AF37;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="picked_upTableBody">
                            <tr style="border-bottom: 1px solid #F0EBE3;"><td colspan="7" style="padding: 2rem; text-align: center; color: #576F72;">No picked up orders.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Initial renders
    renderInvoicesTable();
    renderDeliveriesTable();
    renderPickupsTable();
    renderPickedUpTable();
    renderDeliveredTable();
    updateBillingStats();

    // Add hover and animation styles to stat cards
    const statCards = contentArea.querySelectorAll('.billing-stat-card');
    const subStatCards = contentArea.querySelectorAll('.billing-sub-stat-card');

    statCards.forEach(card => {
        card.addEventListener('mouseenter', function () {
            this.style.transform = 'translateY(-4px)';
            this.style.boxShadow = '0 8px 32px rgba(44, 54, 57, 0.12)';
            this.style.borderColor = '#D4AF37';
        });
        card.addEventListener('mouseleave', function () {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '0 4px 16px rgba(44, 54, 57, 0.08)';
            this.style.borderColor = 'transparent';
        });
    });

    subStatCards.forEach(card => {
        card.addEventListener('mouseenter', function () {
            this.style.transform = 'translateY(-2px)';
            this.style.boxShadow = '0 4px 16px rgba(44, 54, 57, 0.08)';
            this.style.borderColor = '#D4AF37';
        });
        card.addEventListener('mouseleave', function () {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '0 2px 8px rgba(44, 54, 57, 0.06)';
            this.style.borderColor = 'transparent';
        });
    });

    if (typeof updateBillingBadges === 'function') updateBillingBadges();
}

// Switch billing stat section
function switchBillingStatSection(sectionName) {
    const contentArea = document.getElementById('contentArea');

    // Hide all sections
    contentArea.querySelectorAll('.billing-section').forEach(section => {
        section.style.display = 'none';
    });

    // Remove active class from all stat cards
    contentArea.querySelectorAll('.billing-stat-card').forEach(card => {
        card.classList.remove('active');
        card.style.borderColor = 'transparent';
        card.style.boxShadow = '0 4px 16px rgba(44, 54, 57, 0.08)';
    });

    contentArea.querySelectorAll('.billing-sub-stat-card').forEach(card => {
        card.classList.remove('active');
        card.style.borderColor = 'transparent';
        card.style.boxShadow = '0 2px 8px rgba(44, 54, 57, 0.06)';
    });

    // Show selected section
    const sectionId = sectionName + '-section';
    const section = contentArea.querySelector('#' + sectionId);
    if (section) {
        section.style.display = 'block';
    }

    // Set active style on clicked card
    const activeCard = contentArea.querySelector(`[data-section="${sectionName}"]`);
    if (activeCard) {
        activeCard.classList.add('active');
        activeCard.style.borderColor = '#D4AF37';
        activeCard.style.boxShadow = '0 4px 20px rgba(212, 175, 55, 0.2)';
    }
}


// Update billing statistics
// Update billing tab badge counts
function updateBillingBadges() {
    // Delay slightly to ensure DOM is ready
    setTimeout(() => {
        // Count unpaid invoices (matches renderInvoicesTable) - exclude production receipts
        const pendingInvoicesCount = (AppState.billings || []).filter(inv => inv.type !== 'production_receipt' && inv.status !== 'paid').length;

        // Count pending (not delivered) deliveries for for_delivery orders (matches renderDeliveriesTable)
        const pendingDeliveriesCount = (AppState.deliveries || []).filter(d => {
            if (d.status === 'delivered') return false;
            const order = AppState.orders.find(o => o.orderId === d.orderRef);
            return !order || order.deliveryType === 'for_delivery' || !order.deliveryType;
        }).length;

        // Count pickup orders ready for pickup (matches renderPickupsTable)
        const pendingPickupsCount = (AppState.orders || []).filter(o =>
            o.deliveryType === 'for_pickup' && o.status === 'ready_for_pickup'
        ).length;

        // Count picked up orders (matches renderPickedUpTable)
        const pickedUpCount = (AppState.orders || []).filter(o =>
            o.deliveryType === 'for_pickup' && o.status === 'completed' && o.pickupDate
        ).length;

        // Count delivered & paid (matches renderDeliveredTable)
        const deliveredCount = (AppState.deliveries || [])
            .filter(d => d.status === 'delivered')
            .filter(d => (AppState.billings || []).some(b => b.invoiceId === d.invoiceRef && b.status === 'paid'))
            .length;

        // Update new stat cards first (modern layout)
        const contentArea = document.getElementById('contentArea');
        if (contentArea) {
            const invoiceCard = contentArea.querySelector('[data-section="invoices"]');
            const deliveriesCard = contentArea.querySelector('[data-section="deliveries"]');
            const deliveredCard = contentArea.querySelector('[data-section="delivered"]');
            const receiptsCard = contentArea.querySelector('[data-section="receipts"]');
            const pickupsCard = contentArea.querySelector('[data-section="pickups"]');
            const pickedUpCard = contentArea.querySelector('[data-section="picked_up"]');

            if (invoiceCard) {
                const el = invoiceCard.querySelector('div:last-child');
                if (el) el.textContent = pendingInvoicesCount;
            }
            if (deliveriesCard) {
                const el = deliveriesCard.querySelector('div:last-child');
                if (el) el.textContent = pendingDeliveriesCount;
            }
            if (deliveredCard) {
                const el = deliveredCard.querySelector('div:last-child');
                if (el) el.textContent = deliveredCount;
            }
            if (receiptsCard) {
                const el = receiptsCard.querySelector('div:last-child');
                if (el) el.textContent = (AppState.billings || []).filter(b => b.type === 'production_receipt').length;
            }
            if (pickupsCard) {
                const el = pickupsCard.querySelector('div:last-child');
                if (el) el.textContent = pendingPickupsCount;
            }
            if (pickedUpCard) {
                const el = pickedUpCard.querySelector('div:last-child');
                if (el) el.textContent = pickedUpCount;
            }
        }

        // Backwards-compatibility: update legacy tab badges if present
        const invoiceBadge = document.querySelector('[data-tab="invoices"] .badge');
        const deliveriesBadge = document.querySelector('[data-tab="deliveries"] .badge');
        const pickupsBadge = document.querySelector('[data-tab="pickups"] .badge');
        const picked_upBadge = document.querySelector('[data-tab="picked_up"] .badge');
        const deliveredBadge = document.querySelector('[data-tab="delivered"] .badge');
        const receiptsBadge = document.querySelector('[data-tab="receipts"] .badge');

        if (invoiceBadge) invoiceBadge.textContent = pendingInvoicesCount;
        if (deliveriesBadge) deliveriesBadge.textContent = pendingDeliveriesCount;
        if (pickupsBadge) pickupsBadge.textContent = pendingPickupsCount;
        if (picked_upBadge) picked_upBadge.textContent = pickedUpCount;
        if (deliveredBadge) deliveredBadge.textContent = deliveredCount;
        if (receiptsBadge) receiptsBadge.textContent = (AppState.billings || []).filter(b => b.type === 'production_receipt').length;
    }, 100);
}

// Billing Tab Switching - Now delegates to new stat section switching
function switchBillingTab(tabName) {
    // For backwards compatibility, delegate to new system
    if (typeof switchBillingStatSection === 'function') {
        switchBillingStatSection(tabName);
    }
}

// Render Invoices Table (excluding paid + delivered orders)
function renderInvoicesTable() {
    const tbody = document.getElementById('invoicesTableBody');
    if (!tbody) return;
    if (!AppState.billings || AppState.billings.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No invoices found. Create one to bill a customer.</td></tr>';
        return;
    }

    // Show only unpaid invoices and exclude production receipts
    const filteredBillings = AppState.billings.filter(inv => inv.type !== 'production_receipt' && inv.status !== 'paid');

    if (filteredBillings.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No unpaid invoices. All invoices have been paid.</td></tr>';
        return;
    }

    tbody.innerHTML = filteredBillings.map(inv => `
            <tr>
                <td style="padding:0.5rem;">${inv.invoiceId}</td>
                <td style="padding:0.5rem;">${inv.orderRef || '-'}</td>
                <td style="padding:0.5rem;">${inv.customerName || '-'}</td>
                <td style="padding:0.5rem;">₱${(inv.amount || 0).toFixed(2)}</td>
                <td style="padding:0.5rem;">${inv.dueDate || '-'}</td>
                <td style="padding:0.5rem;"><span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#E8F5E9;color:#2E7D32;border-radius:3px;">${formatStatus(inv.status) || 'Unpaid'}</span></td>
                <td style="padding:0.5rem;">
                    <button class="action-btn action-btn-view" onclick="viewInvoice('${inv.invoiceId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">View</button>
                    ${inv.status !== 'paid' ? `<button class="action-btn action-btn-edit" onclick="confirmMarkInvoicePaid('${inv.invoiceId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">Mark Paid</button>` : ''}
                    ${inv.status === 'paid' ? `<button class="action-btn action-btn-edit" onclick="markInvoiceUnpaidConfirm('${inv.invoiceId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;background:#F39C12;color:white;">Mark Unpaid</button>` : ''}
                    <button class="action-btn action-btn-delete" onclick="deleteInvoice('${inv.invoiceId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Delete</button>
                </td>
            </tr>
        `).join('');
}

// Render Receipts Table
function renderReceiptsTable() {
    const tbody = document.getElementById('receiptsTableBody');
    if (!tbody) return;
    // Read filters
    const q = document.getElementById('receipts_search')?.value.trim().toLowerCase() || '';
    const from = document.getElementById('receipts_from')?.value || '';
    const to = document.getElementById('receipts_to')?.value || '';

    const allReceipts = (AppState.billings || []).filter(b => b.type === 'production_receipt');
    const receipts = allReceipts.filter(r => {
        // Search filter
        if (q) {
            const hay = `${r.receiptId || ''} ${r.orderRef || ''} ${r.customerName || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        // Date range filter using ISO date if available
        if (from || to) {
            const d = r.dateISO ? new Date(r.dateISO) : new Date(r.date);
            if (from) {
                const fromD = new Date(from + 'T00:00:00');
                if (d < fromD) return false;
            }
            if (to) {
                const toD = new Date(to + 'T23:59:59');
                if (d > toD) return false;
            }
        }
        return true;
    });
    if (!receipts || receipts.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No receipts found.</td></tr>';
        return;
    }

    tbody.innerHTML = receipts.map(r => `
        <tr>
            <td style="padding:0.5rem;">${r.receiptId}</td>
            <td style="padding:0.5rem;">${r.date}</td>
            <td style="padding:0.5rem;">${r.batchId || '-'}</td>
            <td style="padding:0.5rem;">${r.orderRef || '-'}</td>
            <td style="padding:0.5rem;">${r.customerName || '-'}</td>
            <td style="padding:0.5rem;">₱${(r.total || 0).toFixed(2)}</td>
            <td style="padding:0.5rem;">
                <button class="action-btn action-btn-view" onclick="viewReceipt('${r.receiptId}')">View</button>
                <button class="action-btn action-btn-edit" onclick="printStoredReceipt('${r.receiptId}')">Print</button>
                <button class="action-btn action-btn-delete" onclick="deleteReceipt('${r.receiptId}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

// View a receipt in a modal
function viewReceipt(receiptId) {
    const r = (AppState.billings || []).find(b => b.receiptId === receiptId);
    if (!r) {
        showMessage('Not found', 'Receipt not found', 'error');
        return;
    }

    const itemsHtml = (r.items || []).map(it => `
        <tr>
            <td style="padding:8px;border:1px solid #ddd;">${it.description}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">${it.quantity}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${it.unitPrice.toFixed(2)}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${it.subtotal.toFixed(2)}</td>
        </tr>`).join('');

    const html = `
        <div style="padding:1rem;max-height:600px;overflow:auto;">
            <h3>Receipt: ${r.receiptId}</h3>
            <p><strong>Date:</strong> ${r.date}</p>
            <p><strong>Batch:</strong> ${r.batchId || '-'}</p>
            <p><strong>Order:</strong> ${r.orderRef || '-'}</p>
            <p><strong>Customer:</strong> ${r.customerName || '-'}</p>
            <table style="width:100%;border-collapse:collapse;margin-top:12px;">
                <thead>
                    <tr>
                        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Description</th>
                        <th style="padding:8px;border:1px solid #ddd;text-align:right;">Qty</th>
                        <th style="padding:8px;border:1px solid #ddd;text-align:right;">Unit</th>
                        <th style="padding:8px;border:1px solid #ddd;text-align:right;">Subtotal</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" style="padding:8px;border:1px solid #ddd;text-align:right;">Subtotal</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${(r.subtotal || 0).toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td colspan="3" style="padding:8px;border:1px solid #ddd;text-align:right;">Tax</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${(r.tax || 0).toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td colspan="3" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">Total</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">₱${(r.total || 0).toFixed(2)}</td>
                    </tr>
                </tfoot>
            </table>
            <div style="margin-top:12px;text-align:right;">
                <button class="btn btn-secondary" onclick="closeModal()" style="margin-right:8px;">Close</button>
                <button class="btn btn-primary" onclick="printStoredReceipt('${r.receiptId}')">Print</button>
            </div>
        </div>
    `;

    const modal = createModal(`Receipt - ${r.receiptId}`, html);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

// Print a stored receipt by building html from stored record
function printStoredReceipt(receiptId) {
    const r = (AppState.billings || []).find(b => b.receiptId === receiptId);
    if (!r) return showMessage('Error', 'Receipt not found', 'error');
    const itemsHtml = (r.items || []).map(it => `
        <tr>
            <td style="padding:8px;border:1px solid #ddd;">${it.description}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">${it.quantity}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${it.unitPrice.toFixed(2)}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">₱${it.subtotal.toFixed(2)}</td>
        </tr>`).join('');

    const html = `
      <div style="font-family: Arial, serif; max-width:800px; margin:0 auto;">
        <h2>GoldenThreads IMS</h2>
        <p>${r.date} - Receipt ${r.receiptId}</p>
        <p>Customer: ${r.customerName || '-'}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:12px;">
          <thead>
            <tr><th style="padding:8px;border:1px solid #ddd;text-align:left">Description</th><th style="padding:8px;border:1px solid #ddd;text-align:right">Qty</th><th style="padding:8px;border:1px solid #ddd;text-align:right">Unit</th><th style="padding:8px;border:1px solid #ddd;text-align:right">Subtotal</th></tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot>
            <tr><td colspan="3" style="padding:8px;border:1px solid #ddd;text-align:right">Total</td><td style="padding:8px;border:1px solid #ddd;text-align:right">₱${(r.total || 0).toFixed(2)}</td></tr>
          </tfoot>
        </table>
      </div>
    `;
    printReceipt(html);
}

function clearReceiptsFilters() {
    const s = document.getElementById('receipts_search');
    const f = document.getElementById('receipts_from');
    const t = document.getElementById('receipts_to');
    if (s) s.value = '';
    if (f) f.value = '';
    if (t) t.value = '';
    renderReceiptsTable();
}

function openCreateInvoiceModal() {
    const modalContent = `
            <form id="createInvoiceForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Order Reference</label>
                        <select id="inv_orderRef" class="q-input">
                            <option value="">-- Select Order (optional) --</option>
                            ${AppState.orders.filter(o => {
        // For delivery: must be ready_for_delivery
        // For pickup: can be packaged (going to invoke for pickup)
        let isValidStatus = false;
        if (o.deliveryType === 'for_delivery') isValidStatus = o.status === 'ready_for_delivery';
        if (o.deliveryType === 'for_pickup') isValidStatus = (o.status === 'packaged' || o.status === 'ready_for_pickup');
        if (!isValidStatus) return false;

        // Check if order already has an invoice (exclude it if it does)
        const hasInvoice = (AppState.billings || []).some(b => b.orderRef === o.orderId && b.type !== 'production_receipt');
        return !hasInvoice;
    }).map(o => `<option value="${o.orderId}">${o.orderId} - ${o.customerName}${o.deliveryType === 'for_pickup' ? ' (Pickup)' : ' (Delivery)'}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Invoice Amount (₱)</label>
                        <input type="number" id="inv_amount" class="q-input" min="0" step="0.01" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Customer Name</label>
                        <input type="text" id="inv_customer" class="q-input" required>
                    </div>
                    <div class="form-group" id="dueDateGroup">
                        <label>Due Date</label>
                        <input type="date" id="inv_due" class="q-input">
                    </div>
                </div>
                <div class="form-row" id="orderDetailsRow" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-light); display:none;">
                    <div style="font-size: 0.85rem; color: var(--text-muted);">
                        <strong>Order Details:</strong> <span id="orderDetailsText"></span>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn-primary">Create Invoice</button>
                </div>
            </form>
        `;

    const modal = createLargeModal('Create Invoice', modalContent);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    // Auto-populate when order is selected
    document.getElementById('inv_orderRef').addEventListener('change', function () {
        const orderId = this.value;
        if (orderId) {
            const order = AppState.orders.find(o => o.orderId === orderId);
            if (order) {
                const invoiceAmount = order.quotedAmount || (order.quantity * 500);
                document.getElementById('inv_amount').value = invoiceAmount.toFixed(2);
                document.getElementById('inv_customer').value = order.customerName || '';
                document.getElementById('orderDetailsText').textContent = `${order.garmentType} | ${order.quantity} pcs | Delivery Date: ${order.deliveryDate}`;
                document.getElementById('orderDetailsRow').style.display = 'block';

                // Show/hide due date based on delivery type
                const dueDateGroup = document.getElementById('dueDateGroup');
                if (order.deliveryType === 'for_pickup') {
                    dueDateGroup.style.display = 'none';
                    document.getElementById('inv_due').value = '';
                } else {
                    dueDateGroup.style.display = 'block';
                }
            }
        } else {
            document.getElementById('inv_amount').value = '';
            document.getElementById('inv_customer').value = '';
            document.getElementById('orderDetailsRow').style.display = 'none';
            document.getElementById('dueDateGroup').style.display = 'block';
        }
    });

    document.getElementById('createInvoiceForm').addEventListener('submit', (e) => {
        e.preventDefault();
        createInvoice();
    });
}

async function createInvoice() {
    showLoading('Creating invoice...');
    try {
        const orderRef = document.getElementById('inv_orderRef')?.value || '';
        const amount = parseFloat(document.getElementById('inv_amount')?.value) || 0;
        const customer = document.getElementById('inv_customer')?.value || (orderRef ? (AppState.orders.find(o => o.orderId === orderRef)?.customerName || '') : '');
        const due = document.getElementById('inv_due')?.value || '';

        if (!amount || amount <= 0) {
            hideLoading();
            showMessage('Validation Error', 'Please enter a valid amount', 'warning');
            return;
        }

        const invoice = {
            invoiceId: `INV-${Date.now()}`,
            orderRef: orderRef,
            customerName: customer,
            amount: amount,
            dueDate: due,
            status: 'unpaid',
            type: 'invoice',
            createdDate: new Date().toLocaleDateString()
        };

        AppState.billings.push(invoice);
        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderInvoicesTable();
        updateBillingStats();
        updateBillingBadges();
        showMessage('Success', 'Invoice ' + invoice.invoiceId + ' created!', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error creating invoice:', error);
        showMessage('Error', 'Failed to create invoice: ' + error.message, 'error');
    }
}

function viewInvoice(invoiceId) {
    const inv = AppState.billings.find(i => i.invoiceId === invoiceId);
    if (!inv) return;
    // Find related order and delivery for address fallback
    const relatedOrder = inv.orderRef ? (AppState.orders || []).find(o => o.orderId === inv.orderRef) : null;
    const relatedDelivery = (AppState.deliveries || []).find(d => d.invoiceRef === inv.invoiceId) || null;
    const displayedAddress = (relatedDelivery && relatedDelivery.deliveryAddress) || (relatedOrder && relatedOrder.deliveryAddress) || '-';

    const content = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div>
                    <p><strong>Invoice:</strong> ${inv.invoiceId}</p>
                    <p><strong>Order Ref:</strong> ${inv.orderRef || '-'}</p>
                    <p><strong>Customer:</strong> ${inv.customerName || '-'}</p>
                    <p><strong>Delivery Address:</strong> ${displayedAddress}</p>
                    <p><strong>Amount:</strong> ₱${(inv.amount || 0).toFixed(2)}</p>
                    <p><strong>Due Date:</strong> ${inv.dueDate || '-'}</p>
                    <p><strong>Status:</strong> ${formatStatus(inv.status)}</p>
                </div>
                <div>
                    <p><strong>Created:</strong> ${inv.createdDate}</p>
                    <div style="margin-top:1rem;display:flex;gap:0.5rem;">
                        ${inv.status !== 'paid' ? `<button class="btn btn-primary" onclick="confirmMarkInvoicePaid('${inv.invoiceId}')">Mark as Paid</button>` : ''}
                        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
                    </div>
                </div>
            </div>
        `;
    const modal = createModal('Invoice - ' + inv.invoiceId, content);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function confirmMarkInvoicePaid(invoiceId) {
    const inv = AppState.billings.find(i => i.invoiceId === invoiceId);
    if (!inv) return;
    const modal = createModal('Confirm Payment', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Mark invoice <strong>${invoiceId}</strong> as paid?</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">Amount: <strong>₱${(inv.amount || 0).toFixed(2)}</strong></p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="markInvoicePaidConfirmed('${invoiceId}')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Confirm</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function markInvoicePaidConfirmed(invoiceId) {
    showLoading('Marking invoice as paid...');
    try {
        const inv = AppState.billings.find(i => i.invoiceId === invoiceId);
        if (!inv) {
            hideLoading();
            showMessage('Error', 'Invoice not found', 'error');
            return;
        }
        inv.status = 'paid';
        inv.paymentDate = new Date().toLocaleDateString();
        await syncDataToFirestore();
        hideLoading();
        renderInvoicesTable();
        renderDeliveredTable();
        updateBillingBadges();
        updateBillingStats();
        showMessage('Success', 'Invoice marked as paid successfully!', 'success');
        closeModal();
    } catch (error) {
        hideLoading();
        console.error('Error marking invoice as paid:', error);
        showMessage('Error', 'Failed to update invoice: ' + error.message, 'error');
    }
}

function deleteInvoice(invoiceId) {
    const modal = createModal('Delete Invoice', `
        <div style="padding: 1rem; text-align: center;">
            <div style="margin-bottom: 1rem; font-size: 1rem; color: #e74c3c;">⚠️ Delete Invoice?</div>
            <p style="margin-bottom: 1.5rem; color: #333; font-size: 0.9rem;">This action cannot be undone.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="deleteInvoiceConfirmed('${invoiceId}')" style="padding: 0.75rem 1.5rem; background: #e74c3c;">Delete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function deleteInvoiceConfirmed(invoiceId) {
    closeModal();
    showLoading('Deleting invoice...');
    try {
        AppState.billings = AppState.billings.filter(i => i.invoiceId !== invoiceId);
        await syncDataToFirestore();
        hideLoading();
        renderInvoicesTable();
        renderDeliveredTable();
        updateBillingBadges();
        updateBillingStats();
        showMessage('Success', 'Invoice deleted successfully!', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error deleting invoice:', error);
        showMessage('Error', 'Failed to delete invoice: ' + error.message, 'error');
    }
}

function deleteReceipt(receiptId) {
    const modal = createModal('Delete Receipt', `
        <div style="padding: 1rem; text-align: center;">
            <div style="margin-bottom: 1rem; font-size: 1rem; color: #e74c3c;">⚠️ Delete Receipt?</div>
            <p style="margin-bottom: 1.5rem; color: #333; font-size: 0.9rem;">This action cannot be undone.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="deleteReceiptConfirmed('${receiptId}')" style="padding: 0.75rem 1.5rem; background: #e74c3c;">Delete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function deleteReceiptConfirmed(receiptId) {
    closeModal();
    showLoading('Deleting receipt...');
    try {
        AppState.billings = (AppState.billings || []).filter(b => b.receiptId !== receiptId);
        await syncDataToFirestore();
        hideLoading();
        renderReceiptsTable();
        updateBillingBadges();
        showMessage('Success', 'Receipt deleted successfully!', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error deleting receipt:', error);
        showMessage('Error', 'Failed to delete receipt: ' + error.message, 'error');
    }
}

async function markInvoiceUnpaidConfirm(invoiceId) {
    const inv = AppState.billings.find(i => i.invoiceId === invoiceId);
    if (!inv) return;
    const modal = createModal('Revert to Unpaid', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Mark invoice <strong>${invoiceId}</strong> as unpaid?</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="markInvoiceUnpaidConfirmed('${invoiceId}')" style="padding: 0.75rem 1.5rem; background: #F39C12;">Confirm</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function markInvoiceUnpaidConfirmed(invoiceId) {
    showLoading('Reverting to unpaid...');
    try {
        const inv = AppState.billings.find(i => i.invoiceId === invoiceId);
        if (!inv) {
            hideLoading();
            showMessage('Error', 'Invoice not found', 'error');
            return;
        }
        inv.status = 'unpaid';
        delete inv.paymentDate;
        await syncDataToFirestore();
        hideLoading();
        renderInvoicesTable();
        renderDeliveredTable();
        updateBillingBadges();
        updateBillingStats();
        showMessage('Success', 'Invoice reverted to unpaid!', 'success');
        closeModal();
    } catch (error) {
        hideLoading();
        console.error('Error updating invoice:', error);
        showMessage('Error', 'Failed to update invoice: ' + error.message, 'error');
    }
}

// Deliveries (pending/in-transit only)
function renderDeliveriesTable() {
    const tbody = document.getElementById('deliveriesTableBody');
    if (!tbody) return;
    if (!AppState.deliveries || AppState.deliveries.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No deliveries scheduled.</td></tr>';
        return;
    }

    // Show only pending/in-transit deliveries for for_delivery orders (exclude for_pickup orders)
    const filteredDeliveries = AppState.deliveries.filter(d => {
        if (d.status === 'delivered') return false; // Exclude delivered
        // Only include if associated order is for_delivery
        const order = AppState.orders.find(o => o.orderId === d.orderRef);
        return !order || order.deliveryType === 'for_delivery' || !order.deliveryType;
    });

    if (filteredDeliveries.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No pending deliveries. All deliveries have been completed.</td></tr>';
        return;
    }

    tbody.innerHTML = filteredDeliveries.map(d => `
            <tr>
                <td style="padding:0.5rem;">${d.deliveryId}</td>
                <td style="padding:0.5rem;">${d.invoiceRef || '-'}</td>
                <td style="padding:0.5rem;">${d.orderRef || '-'}</td>
                <td style="padding:0.5rem;">${d.customerName || '-'}</td>
                <td style="padding:0.5rem;">${d.assignedDriver || '-'}</td>
                <td style="padding:0.5rem;"><span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#E8F5E9;color:#2E7D32;border-radius:3px;">${formatStatus(d.status) || 'Pending'}</span></td>
                <td style="padding:0.5rem;">
                    <button class="action-btn action-btn-view" onclick="viewDelivery('${d.deliveryId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">View</button>
                    ${d.status !== 'delivered' ? `<button class="action-btn action-btn-edit" onclick="confirmMarkDeliveryDelivered('${d.deliveryId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Mark Delivered</button>` : ''}
                    ${d.status === 'delivered' ? `<button class="action-btn action-btn-edit" onclick="markDeliveryPendingConfirm('${d.deliveryId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;background:#F39C12;color:white;">Undo Delivered</button>` : ''}
                </td>
            </tr>
        `).join('');
}

function renderPickupsTable() {
    const tbody = document.getElementById('pickupsTableBody');
    if (!tbody) return;

    // Get orders that are for_pickup, ready_for_pickup status, and have an invoice
    const pickupOrders = (AppState.orders || []).filter(o =>
        o.deliveryType === 'for_pickup' && o.status === 'ready_for_pickup' &&
        (AppState.billings || []).some(b => b.orderRef === o.orderId && b.type !== 'production_receipt')
    );

    if (pickupOrders.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No orders pending pickup. Create an invoice and click +New Pickup to add orders.</td></tr>';
        return;
    }

    tbody.innerHTML = pickupOrders.map(o => {
        const statusDisplay = 'Ready for Pickup';
        const statusBadge = `<span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#E3F2FD;color:#1976D2;border-radius:3px;">${statusDisplay}</span>`;
        const hasInvoice = (AppState.billings || []).some(b => b.orderRef === o.orderId && b.type !== 'production_receipt');
        const invoiceBadge = hasInvoice
            ? `<span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#C8E6C9;color:#2E7D32;border-radius:3px;">✓ Invoice</span>`
            : `<span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#FFCCBC;color:#D84315;border-radius:3px;">⚠ No Invoice</span>`;
        return `<tr>
            <td style="padding:0.5rem;">${o.orderId || '-'}</td>
            <td style="padding:0.5rem;">${o.customerName || '-'}</td>
            <td style="padding:0.5rem;">${o.garmentType || '-'}</td>
            <td style="padding:0.5rem;">${o.quantity || 0}</td>
            <td style="padding:0.5rem;">${invoiceBadge}</td>
            <td style="padding:0.5rem;">${statusBadge}</td>
            <td style="padding:0.5rem;">
                <button class="action-btn action-btn-view" onclick="viewPickupOrder('${o.orderId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">View</button>
                <button class="action-btn action-btn-edit" onclick="confirmMarkPickupCompleted('${o.orderId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Picked Up</button>
            </td>
        </tr>`;
    }).join('');
}

function viewPickupOrder(orderId) {
    // Show pickup order details in modal
    const order = AppState.orders.find(o => o.orderId === orderId) || {};
    if (!order) {
        return showMessage('Not Found', 'Order not found', 'error');
    }

    const modal = createModal('Pickup Order Details - ' + orderId, `
        <div style="padding:1rem;max-height:520px;overflow:auto;">
            <div style="margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid #ddd;">
                <h3 style="margin:0 0 1rem 0;">Order Details</h3>
                <p><strong>Order ID:</strong> ${order.orderId}</p>
                <p><strong>Customer:</strong> ${order.customerName || '-'}</p>
                <p><strong>Contact:</strong> ${order.customerPhone || '-'}</p>
                <p><strong>Garment Type:</strong> ${order.garmentType || '-'}</p>
                <p><strong>Quantity:</strong> ${order.quantity || 0} pcs</p>
                <p><strong>Status:</strong> <span style="display:inline-block;padding:0.25rem 0.5rem;background:#E3F2FD;color:#1976D2;border-radius:3px;">${(order.status || '').replace(/_/g, ' ')}</span></p>
            </div>
            <div style="margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid #ddd;">
                <h3 style="margin:0 0 1rem 0;">Size Breakdown</h3>
                ${(() => {
            const sizes = order.sizes || [];
            if (sizes.length === 0) {
                return '<p style="margin: 0.5rem 0; color: #999; font-style: italic;">No size information</p>';
            }
            return '<table style="width:100%;font-size:0.9rem;"><tr style="border-bottom:1px solid #ddd;"><th style="text-align:left;padding:0.5rem;">Size</th><th style="text-align:right;padding:0.5rem;">Qty</th></tr>' +
                sizes.map(s => `<tr style="border-bottom:1px solid #eee;"><td style="padding:0.5rem;">${s.size || '-'}</td><td style="text-align:right;padding:0.5rem;">${s.quantity || 0}</td></tr>`).join('') +
                '</table>';
        })()}
            </div>
            <div style="margin-top:1rem;text-align:center;">
                <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            </div>
        </div>
        `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function renderPickedUpTable() {
    const tbody = document.getElementById('picked_upTableBody');
    if (!tbody) return;

    // Get orders that are for_pickup, completed, and have a pickupDate
    const pickedUpOrders = (AppState.orders || []).filter(o =>
        o.deliveryType === 'for_pickup' && o.status === 'completed' && o.pickupDate
    );

    if (pickedUpOrders.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No picked up orders.</td></tr>';
        return;
    }

    tbody.innerHTML = pickedUpOrders.map(o => {
        const pickupDate = o.pickupDate || '-';
        const statusBadge = `<span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#C8E6C9;color:#2E7D32;border-radius:3px;">✓ Picked Up</span>`;
        return `<tr>
            <td style="padding:0.5rem;">${o.orderId || '-'}</td>
            <td style="padding:0.5rem;">${o.customerName || '-'}</td>
            <td style="padding:0.5rem;">${o.garmentType || '-'}</td>
            <td style="padding:0.5rem;">${o.quantity || 0}</td>
            <td style="padding:0.5rem;">${pickupDate}</td>
            <td style="padding:0.5rem;">${statusBadge}</td>
            <td style="padding:0.5rem;">
                <button class="action-btn action-btn-view" onclick="viewPickupOrder('${o.orderId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">View</button>
            </td>
        </tr>`;
    }).join('');
}

function confirmMarkPickupCompleted(orderId) {
    const order = AppState.orders.find(o => o.orderId === orderId);
    if (!order) return;

    // Check if invoice exists for this order
    const invoice = (AppState.billings || []).find(b => b.orderRef === orderId && b.type !== 'production_receipt');
    if (!invoice) {
        showMessage('Invoice Required', `Please create an invoice for order ${orderId} before marking as picked up.`, 'warning');
        return;
    }

    const modal = createModal('Confirm Pickup', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Mark order <strong>${orderId}</strong> as picked up?</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">Customer: <strong>${order.customerName || '-'}</strong><br/>Garment: <strong>${order.garmentType || '-'}</strong><br/>Quantity: <strong>${order.quantity || 0} pcs</strong></p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="markPickupCompletedConfirmed('${orderId}')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Confirm</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function markPickupCompletedConfirmed(orderId) {
    showLoading('Marking as picked up...');
    try {
        const order = AppState.orders.find(o => o.orderId === orderId);
        if (!order) {
            hideLoading();
            showMessage('Error', 'Order not found', 'error');
            return;
        }
        order.status = 'completed';
        order.pickupDate = new Date().toLocaleDateString();

        // Reduce produced inventory items associated with this pickup order
        try {
            const qtyToConsume = (order && order.quantity) ? parseFloat(order.quantity) : 0;
            if (qtyToConsume > 0) {
                // Find production catalog items that match the customer or produced for this order
                const candidates = (AppState.inventoryCatalogItems || []).filter(i => i.source === 'production' && (i.orderCustomer === order.customerName || (i.description || '').includes(orderId)));
                let remaining = qtyToConsume;
                const consumed = [];
                for (const c of candidates) {
                    if (remaining <= 0) break;
                    const avail = parseFloat(c.quantity) || 0;
                    if (avail <= 0) continue;
                    if (avail > remaining) {
                        // consume part of this item
                        c.quantity = avail - remaining;
                        consumed.push({ sku: c.sku, qty: remaining, snapshot: null });
                        remaining = 0;
                    } else {
                        // consume entire item
                        const idx = AppState.inventoryCatalogItems.findIndex(x => x.sku === c.sku);
                        if (idx !== -1) {
                            // save full snapshot for possible revert
                            consumed.push({ sku: c.sku, qty: avail, snapshot: JSON.parse(JSON.stringify(AppState.inventoryCatalogItems[idx])) });
                            AppState.inventoryCatalogItems.splice(idx, 1);
                        } else {
                            consumed.push({ sku: c.sku, qty: avail, snapshot: null });
                        }
                        remaining -= avail;
                    }
                }
                if (remaining > 0) {
                    console.warn('Not enough produced inventory to fully consume for picked up order', orderId, 'remaining', remaining);
                }
            }
        } catch (e) {
            console.error('Error consuming produced inventory on pickup:', e);
        }

        await syncDataToFirestore();
        hideLoading();
        renderPickupsTable();
        renderPickedUpTable();
        renderOrderCatalog();
        // Ensure Packaging view is refreshed so this picked-up order disappears
        if (typeof renderPackagingOrders === 'function') renderPackagingOrders();
        // Refresh dashboard stats as delivery/out-for-delivery flow does
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        updateBillingBadges();
        showMessage('Success', `Order ${orderId} marked as picked up`, 'success');
    } catch (err) {
        hideLoading();
        console.error('Error marking pickup:', err);
        showMessage('Error', 'Failed to mark as picked up: ' + (err.message || err), 'error');
    }
}

// Helper: Count orders that are paid AND delivered
function getDeliveredOrdersCount() {
    const paidInvoiceIds = new Set((AppState.billings || []).filter(b => b.status === 'paid').map(b => b.invoiceId));
    const deliveredInvoiceIds = new Set((AppState.deliveries || []).filter(d => d.status === 'delivered').map(d => d.invoiceRef));
    let count = 0;
    for (const invoiceId of deliveredInvoiceIds) {
        if (paidInvoiceIds.has(invoiceId)) count++;
    }
    return count;
}

// Render Delivered Orders Table (paid + delivered)
function renderDeliveredTable() {
    const tbody = document.getElementById('deliveredTableBody');
    if (!tbody) return;

    // Get deliveries that are marked as delivered
    const deliveredDeliveries = (AppState.deliveries || []).filter(d => d.status === 'delivered');
    if (deliveredDeliveries.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No delivered and paid orders.</td></tr>';
        return;
    }

    // Filter to only include those where the associated invoice is paid
    const deliveredAndPaid = deliveredDeliveries.filter(d => {
        const invoice = (AppState.billings || []).find(b => b.invoiceId === d.invoiceRef);
        return invoice && invoice.status === 'paid';
    });

    if (deliveredAndPaid.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No delivered and paid orders.</td></tr>';
        return;
    }

    tbody.innerHTML = deliveredAndPaid.map(d => {
        const invoice = (AppState.billings || []).find(b => b.invoiceId === d.invoiceRef);
        const order = (AppState.orders || []).find(o => o.orderId === d.orderRef);
        return `
            <tr>
                <td style="padding:0.5rem;">${d.orderRef || '-'}</td>
                <td style="padding:0.5rem;">${d.invoiceRef || '-'}</td>
                <td style="padding:0.5rem;">${d.customerName || '-'}</td>
                <td style="padding:0.5rem;">₱${(invoice && invoice.amount || 0).toFixed(2)}</td>
                <td style="padding:0.5rem;">${d.deliveryDate || '-'}</td>
                <td style="padding:0.5rem;"><span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#27AE60;color:white;border-radius:3px;">✅ Delivered</span></td>
                <td style="padding:0.5rem;">
                    <button class="action-btn action-btn-view" onclick="viewDeliveredOrderHistory('${d.deliveryId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;">View History</button>
                </td>
            </tr>
        `;
    }).join('');
}

// View full order history (invoice + delivery details)
function viewDeliveredOrderHistory(deliveryId) {
    const delivery = (AppState.deliveries || []).find(d => d.deliveryId === deliveryId);
    if (!delivery) {
        showMessage('Error', 'Delivery not found', 'error');
        return;
    }

    const invoice = (AppState.billings || []).find(b => b.invoiceId === delivery.invoiceRef);
    const order = (AppState.orders || []).find(o => o.orderId === delivery.orderRef);

    const content = `
        <div style="padding: 1.5rem; line-height: 1.8;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem;">
                <!-- ORDER INFO -->
                <div style="border-right: 1px solid #ddd; padding-right: 1rem;">
                    <h3 style="color: #34495e; margin-bottom: 1rem;">📋 Order Information</h3>
                    <p><strong>Order ID:</strong> ${order && order.orderId || delivery.orderRef || '-'}</p>
                    <p><strong>Customer:</strong> ${delivery.customerName || '-'}</p>
                    <p><strong>Garment Type:</strong> ${order && order.garmentType || '-'}</p>
                    <p><strong>Quantity:</strong> ${order && order.quantity || '-'} pcs</p>
                    <p><strong>Ordered Date:</strong> ${order && order.createdDate || '-'}</p>
                    <p><strong>Delivery Date:</strong> ${delivery && delivery.deliveryDate || order && order.deliveryDate || '-'}</p>
                </div>

                <!-- INVOICE INFO -->
                <div>
                    <h3 style="color: #34495e; margin-bottom: 1rem;">💰 Invoice Information</h3>
                    <p><strong>Invoice ID:</strong> ${invoice && invoice.invoiceId || delivery.invoiceRef || '-'}</p>
                    <p><strong>Amount:</strong> ₱${(invoice && invoice.amount || 0).toFixed(2)}</p>
                    <p><strong>Due Date:</strong> ${invoice && invoice.dueDate || '-'}</p>
                    <p><strong>Invoice Status:</strong> <span style="padding:0.25rem 0.75rem;background:#27AE60;color:white;border-radius:3px;font-size:0.9rem;">✅ ${formatStatus(invoice && invoice.status || 'Unknown')}</span></p>
                    <p><strong>Payment Date:</strong> ${invoice && invoice.paymentDate || '-'}</p>
                </div>
            </div>

            <!-- DELIVERY INFO -->
            <div style="border-top: 1px solid #ddd; padding-top: 1.5rem;">
                <h3 style="color: #34495e; margin-bottom: 1rem;">🚚 Delivery Information</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1.5rem;">
                    <div>
                        <p><strong>Delivery ID:</strong> ${delivery.deliveryId || '-'}</p>
                        <p><strong>Assigned Driver:</strong> ${delivery.assignedDriver || '-'}</p>
                    </div>
                    <div>
                        <p><strong>Tracking No.:</strong> ${delivery.trackingNumber || '-'}</p>
                        <p><strong>Delivery Date:</strong> ${delivery.deliveryDate || '-'}</p>
                    </div>
                    <div>
                        <p><strong>Status:</strong> <span style="padding:0.25rem 0.75rem;background:#27AE60;color:white;border-radius:3px;font-size:0.9rem;">✅ ${formatStatus(delivery.status)}</span></p>
                    </div>
                </div>
            </div>

                <div style="border-top: 1px solid #ddd; padding-top: 1.25rem; margin-top: 1rem;">
                    <h4 style="margin-bottom:0.5rem;">📍 Delivery Address</h4>
                    <p style="color:#555;">${delivery.deliveryAddress || (order && order.deliveryAddress) || '-'}</p>
                </div>

            <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #ddd; text-align: center; color: #27AE60; font-weight: bold;">
                ✅ ORDER COMPLETED - PAID & DELIVERED
            </div>

            <div style="margin-top: 1.5rem; text-align: right;">
                <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            </div>
        </div>
    `;

    const modal = createLargeModal(`Completed Order - ${delivery.orderRef}`, content);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}
function openCreateDeliveryModal() {
    // Get orders that have invoices created, but exclude those already delivered AND exclude for_pickup orders
    const ordersWithInvoicesRaw = AppState.orders.filter(o =>
        (o.deliveryType === 'for_delivery' || !o.deliveryType) &&  // Only for_delivery or unspecified (legacy)
        AppState.billings.some(b => b.orderRef === o.orderId)
    );

    // Available invoices: exclude invoices already used in a delivered delivery, exclude production receipts, and exclude for_pickup orders
    const availableBillings = (AppState.billings || []).filter(b => {
        const relatedOrder = AppState.orders.find(o => o.orderId === b.orderRef);
        return b.type !== 'production_receipt' &&
            !AppState.deliveries.some(d => d.invoiceRef === b.invoiceId) &&
            (relatedOrder?.deliveryType === 'for_delivery' || !relatedOrder?.deliveryType);
    });

    // Available orders: exclude orders already used in a delivered delivery, and exclude for_pickup orders
    const availableOrders = (ordersWithInvoicesRaw || []).filter(o =>
        !AppState.deliveries.some(d => d.orderRef === o.orderId)
    );

    const modalContent = `
            <form id="createDeliveryForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Invoice Reference</label>
                        <select id="del_invoiceRef" class="q-input">
                            <option value="">-- Select Invoice (optional) --</option>
                            ${availableBillings.map(b => `<option value="${b.invoiceId}">${b.invoiceId} - ${b.customerName}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Order Reference</label>
                        <input type="text" id="del_orderRef" class="q-input" readonly style="background-color: #f5f5f5; cursor: not-allowed;">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Assigned Driver</label>
                        <select id="del_driver" class="q-input">
                            <option value="">-- Select Driver --</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Tracking No.</label>
                        <input type="text" id="del_tracking" class="q-input" readonly style="background-color: #f5f5f5; cursor: not-allowed;">
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn-primary">Create Delivery</button>
                </div>
            </form>
        `;

    const modal = createLargeModal('Create Delivery', modalContent);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    // Populate employee dropdowns after modal is added to DOM
    populateEmployeeDropdown('del_driver', 'Driver');

    document.getElementById('createDeliveryForm').addEventListener('submit', (e) => {
        e.preventDefault();
        createDelivery();
    });

    // Add event listener for invoice reference change to auto-generate order ref and tracking no
    document.getElementById('del_invoiceRef').addEventListener('change', () => {
        autoGenerateDeliveryFields();
    });
}

function autoGenerateDeliveryFields() {
    const invoiceRef = document.getElementById('del_invoiceRef')?.value || '';
    const orderRefInput = document.getElementById('del_orderRef');
    const trackingInput = document.getElementById('del_tracking');

    if (!invoiceRef) {
        if (orderRefInput) orderRefInput.value = '';
        if (trackingInput) trackingInput.value = '';
        return;
    }

    // Find the invoice and get its order reference
    const invoice = AppState.billings.find(b => b.invoiceId === invoiceRef);
    if (invoice && invoice.orderRef) {
        if (orderRefInput) orderRefInput.value = invoice.orderRef;
    }

    // Generate tracking number
    const trackingNumber = generateTrackingNumber();
    if (trackingInput) trackingInput.value = trackingNumber;
}

function generateTrackingNumber() {
    // Format: TRK-{4-digit random}-{timestamp-last4}
    const randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const timestampPart = Date.now().toString().slice(-4);
    return `TRK-${randomPart}-${timestampPart}`;
}

async function createDelivery() {
    showLoading('Creating delivery...');
    try {
        const invoiceRef = document.getElementById('del_invoiceRef')?.value || '';
        const orderRef = document.getElementById('del_orderRef')?.value || '';
        const driver = document.getElementById('del_driver')?.value || '';
        const tracking = document.getElementById('del_tracking')?.value || '';

        // Validate invoice reference is provided
        if (!invoiceRef) {
            hideLoading();
            showMessage('Validation Error', 'Please select an invoice for this delivery', 'warning');
            return;
        }

        const invoice = AppState.billings.find(b => b.invoiceId === invoiceRef);
        if (!invoice) {
            hideLoading();
            showMessage('Error', 'Selected invoice not found', 'error');
            return;
        }
        const orderObj = orderRef ? AppState.orders.find(o => o.orderId === orderRef) : null;
        const customer = invoice.customerName || (orderObj ? orderObj.customerName || '' : '');

        const delivery = {
            deliveryId: `DEL-${Date.now()}`,
            invoiceRef: invoiceRef,
            orderRef: orderRef,
            customerName: customer,
            assignedDriver: driver,
            trackingNumber: tracking,
            deliveryAddress: (orderObj && orderObj.deliveryAddress) || invoice.deliveryAddress || '',
            status: 'pending',
            createdDate: new Date().toLocaleDateString()
        };

        AppState.deliveries.push(delivery);
        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderDeliveriesTable();
        updateBillingStats();
        updateBillingBadges();
        showMessage('Success', 'Delivery ' + delivery.deliveryId + ' scheduled!', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error creating delivery:', error);
        showMessage('Error', 'Failed to create delivery: ' + error.message, 'error');
    }
}

function viewDelivery(deliveryId) {
    const d = AppState.deliveries.find(x => x.deliveryId === deliveryId);
    if (!d) return;
    const relatedOrderForDelivery = d.orderRef ? (AppState.orders || []).find(o => o.orderId === d.orderRef) : null;
    const content = `
            <div>
                <p><strong>Delivery ID:</strong> ${d.deliveryId}</p>
                <p><strong>Invoice:</strong> ${d.invoiceRef || '-'}</p>
                <p><strong>Order:</strong> ${d.orderRef || '-'}</p>
                <p><strong>Customer:</strong> ${d.customerName || '-'}</p>
                <p><strong>Delivery Address:</strong> ${d.deliveryAddress || (relatedOrderForDelivery && relatedOrderForDelivery.deliveryAddress) || '-'}</p>
                <p><strong>Assigned Driver:</strong> ${d.assignedDriver || '-'}</p>
                <p><strong>Tracking #:</strong> ${d.trackingNumber || '-'}</p>
                <p><strong>Status:</strong> ${formatStatus(d.status)}</p>
                <div style="margin-top:1rem;display:flex;gap:0.5rem;">
                    ${d.status === 'pending' ? `<button class="btn btn-primary" onclick="confirmMarkDeliveryOutForDelivery('${d.deliveryId}')">Mark Out for Delivery</button>` : ''}
                    ${d.status !== 'delivered' ? `<button class="btn btn-primary" onclick="confirmMarkDeliveryDelivered('${d.deliveryId}')">Mark Delivered</button>` : ''}
                    <button class="btn btn-secondary" onclick="closeModal()">Close</button>
                </div>
            </div>
        `;
    const modal = createModal('Delivery - ' + d.deliveryId, content);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function confirmMarkDeliveryOutForDelivery(deliveryId) {
    const d = AppState.deliveries.find(x => x.deliveryId === deliveryId);
    if (!d) return;
    const modal = createModal('Confirm Out for Delivery', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Mark delivery <strong>${deliveryId}</strong> as Out for Delivery?</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">Customer: <strong>${d.customerName || '-'}</strong><br/>Tracking: <strong>${d.trackingNumber || 'N/A'}</strong></p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="markDeliveryOutForDeliveryConfirmed('${deliveryId}')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Confirm</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function markDeliveryOutForDeliveryConfirmed(deliveryId) {
    showLoading('Marking out for delivery...');
    try {
        const d = AppState.deliveries.find(x => x.deliveryId === deliveryId);
        if (!d) {
            hideLoading();
            showMessage('Error', 'Delivery not found', 'error');
            return;
        }
        d.status = 'transit';
        d.outForDeliveryDate = new Date().toLocaleDateString();

        // Update related order status so it disappears from packaging
        if (d.orderRef) {
            const order = AppState.orders.find(o => o.orderId === d.orderRef);
            if (order) {
                order.status = 'out_for_delivery';
            }
        }

        await syncDataToFirestore();
        hideLoading();
        renderDeliveriesTable();
        renderPackagingOrders();
        updateBillingBadges();
        updateDashboardStats();
        closeModal();
        showMessage('Success', 'Delivery marked as out for delivery.', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error marking out for delivery:', error);
        showMessage('Error', 'Failed to update delivery: ' + error.message, 'error');
    }
}

function openCreatePickupModal() {
    // Get invoices for for_pickup orders that can still be marked ready for pickup
    // Exclude: already ready_for_pickup, already completed (picked up or delivered), or not for_pickup type
    const availableBillings = (AppState.billings || []).filter(b => {
        const relatedOrder = AppState.orders.find(o => o.orderId === b.orderRef);
        return b.type !== 'production_receipt' &&
            relatedOrder?.deliveryType === 'for_pickup' &&
            relatedOrder?.status !== 'completed';
    });

    const modalContent = `
            <form id="createPickupForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Invoice Reference</label>
                        <select id="pickup_invoiceRef" class="q-input">
                            <option value="">-- Select Invoice (optional) --</option>
                            ${availableBillings.map(b => `<option value="${b.invoiceId}">${b.invoiceId} - ${b.customerName}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Order Reference</label>
                        <input type="text" id="pickup_orderRef" class="q-input" readonly style="background-color: #f5f5f5; cursor: not-allowed;">
                    </div>
                </div>
                <div class="form-row" id="pickupOrderDetailsRow" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-light); display:none;">
                    <div style="font-size: 0.85rem; color: var(--text-muted);">
                        <strong>Order Details:</strong> <span id="pickupOrderDetailsText"></span>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn-primary">Mark Ready for Pickup</button>
                </div>
            </form>
        `;

    const modal = createLargeModal('Add Order to Pickups', modalContent);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    // Auto-populate details when invoice is selected
    document.getElementById('pickup_invoiceRef').addEventListener('change', () => {
        autoGeneratePickupFields();
    });

    document.getElementById('createPickupForm').addEventListener('submit', (e) => {
        e.preventDefault();
        markOrderReadyForPickup();
    });
}

function autoGeneratePickupFields() {
    const invoiceRef = document.getElementById('pickup_invoiceRef')?.value || '';
    const orderRefInput = document.getElementById('pickup_orderRef');
    const pickupOrderDetailsRow = document.getElementById('pickupOrderDetailsRow');
    const pickupOrderDetailsText = document.getElementById('pickupOrderDetailsText');

    if (!invoiceRef) {
        orderRefInput.value = '';
        pickupOrderDetailsRow.style.display = 'none';
        return;
    }

    // Find the invoice and related order
    const invoice = AppState.billings.find(b => b.invoiceId === invoiceRef);
    const order = invoice ? AppState.orders.find(o => o.orderId === invoice.orderRef) : null;

    if (order) {
        orderRefInput.value = order.orderId || '';
        pickupOrderDetailsText.textContent = `${order.garmentType || '-'} | ${order.quantity || 0} pcs`;
        pickupOrderDetailsRow.style.display = 'block';
    }
}

async function markOrderReadyForPickup() {
    showLoading('Marking order ready for pickup...');
    try {
        const orderId = document.getElementById('pickup_orderRef')?.value || '';
        if (!orderId) {
            hideLoading();
            showMessage('Validation Error', 'Please select an invoice', 'warning');
            return;
        }

        const order = AppState.orders.find(o => o.orderId === orderId);
        if (!order) {
            hideLoading();
            showMessage('Error', 'Order not found', 'error');
            return;
        }

        // Update order status to ready_for_pickup
        order.status = 'ready_for_pickup';
        await syncDataToFirestore();

        hideLoading();
        closeModal();
        renderPickupsTable();
        updateBillingBadges();
        showMessage('Success', `Order ${orderId} is now ready for pickup`, 'success');
    } catch (error) {
        hideLoading();
        console.error('Error marking order ready for pickup:', error);
        showMessage('Error', 'Failed to mark order ready: ' + error.message, 'error');
    }
}

function confirmMarkDeliveryDelivered(deliveryId) {
    const d = AppState.deliveries.find(x => x.deliveryId === deliveryId);
    if (!d) return;
    const modal = createModal('Confirm Delivery', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Mark delivery <strong>${deliveryId}</strong> as delivered?</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">Customer: <strong>${d.customerName || '-'}</strong><br/>Tracking: <strong>${d.trackingNumber || 'N/A'}</strong></p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="markDeliveryDeliveredConfirmed('${deliveryId}')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Confirm</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function markDeliveryDeliveredConfirmed(deliveryId) {
    showLoading('Marking delivery as delivered...');
    try {
        const d = AppState.deliveries.find(x => x.deliveryId === deliveryId);
        if (!d) {
            hideLoading();
            showMessage('Error', 'Delivery not found', 'error');
            return;
        }
        d.status = 'delivered';
        d.deliveryDate = new Date().toLocaleDateString();

        // Update related order status to completed - only the specific order
        if (d.orderRef) {
            const orderIndex = AppState.orders.findIndex(o => o.orderId === d.orderRef);
            if (orderIndex !== -1) {
                AppState.orders[orderIndex].status = 'completed';
                console.log(`Order ${d.orderRef} marked as completed`);
            }
        } else {
            console.warn('Delivery has no orderRef:', d);
        }

        // Reduce produced inventory items associated with this order (if any)
        try {
            if (d.orderRef) {
                const relatedOrder = AppState.orders.find(o => o.orderId === d.orderRef) || null;
                const qtyToConsume = (relatedOrder && relatedOrder.quantity) ? parseFloat(relatedOrder.quantity) : 0;
                if (qtyToConsume > 0) {
                    // Find production catalog items that match the customer or produced for this order
                    const candidates = (AppState.inventoryCatalogItems || []).filter(i => i.source === 'production' && (i.orderCustomer === relatedOrder.customerName || (i.description || '').includes(d.orderRef)));
                    let remaining = qtyToConsume;
                    const consumed = [];
                    for (const c of candidates) {
                        if (remaining <= 0) break;
                        const avail = parseFloat(c.quantity) || 0;
                        if (avail <= 0) continue;
                        if (avail > remaining) {
                            // consume part of this item
                            c.quantity = avail - remaining;
                            consumed.push({ sku: c.sku, qty: remaining, snapshot: null });
                            remaining = 0;
                        } else {
                            // consume entire item
                            const idx = AppState.inventoryCatalogItems.findIndex(x => x.sku === c.sku);
                            if (idx !== -1) {
                                // save full snapshot so we can restore if delivery is reverted
                                consumed.push({ sku: c.sku, qty: avail, snapshot: JSON.parse(JSON.stringify(AppState.inventoryCatalogItems[idx])) });
                                AppState.inventoryCatalogItems.splice(idx, 1);
                            } else {
                                consumed.push({ sku: c.sku, qty: avail, snapshot: null });
                            }
                            remaining -= avail;
                        }
                    }
                    // Attach consumed adjustments to delivery record for possible revert
                    if (!d.consumedCatalogAdjustments) d.consumedCatalogAdjustments = [];
                    d.consumedCatalogAdjustments = d.consumedCatalogAdjustments.concat(consumed);
                    if (remaining > 0) {
                        console.warn('Not enough produced inventory to fully consume for order', d.orderRef, 'remaining', remaining);
                    }
                }
            }
        } catch (e) {
            console.error('Error consuming produced inventory on delivery:', e);
        }

        await syncDataToFirestore();
        hideLoading();
        renderDeliveriesTable();
        renderDeliveredTable();
        updateBillingBadges();
        renderOrdersTable();
        updateBillingStats();
        updateDashboardStats();
        updateProductionStats();
        showMessage('Success', 'Delivery marked as delivered!', 'success');
        closeModal();
    } catch (error) {
        hideLoading();
        console.error('Error marking delivery:', error);
        showMessage('Error', 'Failed to update delivery: ' + error.message, 'error');
    }
}

async function markDeliveryPendingConfirm(deliveryId) {
    const d = AppState.deliveries.find(x => x.deliveryId === deliveryId);
    if (!d) return;
    const modal = createModal('Revert to Pending', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Mark delivery <strong>${deliveryId}</strong> as pending?</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">This will undo the delivery completion.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="markDeliveryPendingConfirmed('${deliveryId}')" style="padding: 0.75rem 1.5rem; background: #F39C12;">Confirm</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function markDeliveryPendingConfirmed(deliveryId) {
    showLoading('Reverting delivery status...');
    try {
        const d = AppState.deliveries.find(x => x.deliveryId === deliveryId);
        if (!d) {
            hideLoading();
            showMessage('Error', 'Delivery not found', 'error');
            return;
        }
        d.status = 'pending';
        delete d.deliveryDate;
        // Revert order status back to ready_for_delivery
        if (d.orderRef) {
            const order = AppState.orders.find(o => o.orderId === d.orderRef);
            if (order) order.status = 'ready_for_delivery';
        }
        // Restore consumed produced inventory if we recorded adjustments
        try {
            if (d.consumedCatalogAdjustments && Array.isArray(d.consumedCatalogAdjustments) && d.consumedCatalogAdjustments.length > 0) {
                d.consumedCatalogAdjustments.forEach(adj => {
                    if (!adj || !adj.sku) return;
                    const existing = (AppState.inventoryCatalogItems || []).find(i => i.sku === adj.sku);
                    if (existing) {
                        existing.quantity = (existing.quantity || 0) + (adj.qty || 0);
                    } else if (adj.snapshot) {
                        // restore original snapshot (it contained full item data)
                        const snapshot = JSON.parse(JSON.stringify(adj.snapshot));
                        // if snapshot.qty differs, set to qty
                        snapshot.quantity = snapshot.quantity || adj.qty || 0;
                        AppState.inventoryCatalogItems.push(snapshot);
                    } else {
                        // No snapshot, create a placeholder item
                        AppState.inventoryCatalogItems.push({
                            sku: adj.sku,
                            name: adj.sku,
                            category: 'Finished Goods',
                            quantity: adj.qty || 0,
                            unit: 'pieces',
                            unitPrice: 0,
                            source: 'production',
                            addedDate: new Date().toLocaleDateString(),
                            addedBy: AppState.currentUser?.username || 'system'
                        });
                    }
                });
                // clear recorded adjustments after restore
                delete d.consumedCatalogAdjustments;
            }
        } catch (e) {
            console.error('Error restoring consumed produced inventory:', e);
        }
        await syncDataToFirestore();
        hideLoading();
        renderDeliveriesTable();
        renderDeliveredTable();
        updateBillingBadges();
        renderOrdersTable();
        updateBillingStats();
        updateDashboardStats();
        updateProductionStats();
        showMessage('Success', 'Delivery reverted to pending!', 'success');
        closeModal();
    } catch (error) {
        hideLoading();
        console.error('Error reverting delivery:', error);
        showMessage('Error', 'Failed to update delivery: ' + error.message, 'error');
    }
}

function updateBillingStats() {
    // Calculate counts for stat cards
    const pendingInvoicesCount = (AppState.billings || []).filter(inv => inv.type !== 'production_receipt' && inv.status !== 'paid').length;
    const pendingDeliveriesCount = (AppState.deliveries || []).filter(d => {
        if (d.status === 'delivered') return false;
        const order = AppState.orders.find(o => o.orderId === d.orderRef);
        return !order || order.deliveryType === 'for_delivery' || !order.deliveryType;
    }).length;
    const deliveredCount = (AppState.deliveries || [])
        .filter(d => d.status === 'delivered')
        .filter(d => (AppState.billings || []).some(b => b.invoiceId === d.invoiceRef && b.status === 'paid'))
        .length;
    const pendingPickupsCount = (AppState.orders || []).filter(o =>
        o.deliveryType === 'for_pickup' && o.status === 'ready_for_pickup'
    ).length;
    const pickedUpCount = (AppState.orders || []).filter(o =>
        o.deliveryType === 'for_pickup' && o.status === 'completed' && o.pickupDate
    ).length;
    const receiptsCount = (AppState.billings || []).filter(b => b.type === 'production_receipt').length;

    // Update main stat cards
    const contentArea = document.getElementById('contentArea');
    if (contentArea) {
        const invoiceStatCard = contentArea.querySelector('[data-section="invoices"]');
        const deliveryStatCard = contentArea.querySelector('[data-section="deliveries"]');
        const deliveredStatCard = contentArea.querySelector('[data-section="delivered"]');
        const receiptsStatCard = contentArea.querySelector('[data-section="receipts"]');
        const pickupsStatCard = contentArea.querySelector('[data-section="pickups"]');
        const pickedUpStatCard = contentArea.querySelector('[data-section="picked_up"]');

        if (invoiceStatCard) {
            const countEl = invoiceStatCard.querySelector('div:last-child');
            if (countEl) countEl.textContent = pendingInvoicesCount;
        }
        if (deliveryStatCard) {
            const countEl = deliveryStatCard.querySelector('div:last-child');
            if (countEl) countEl.textContent = pendingDeliveriesCount;
        }
        if (deliveredStatCard) {
            const countEl = deliveredStatCard.querySelector('div:last-child');
            if (countEl) countEl.textContent = deliveredCount;
        }
        if (receiptsStatCard) {
            const countEl = receiptsStatCard.querySelector('div:last-child');
            if (countEl) countEl.textContent = receiptsCount;
        }
        if (pickupsStatCard) {
            const countEl = pickupsStatCard.querySelector('div:last-child');
            if (countEl) countEl.textContent = pendingPickupsCount;
        }
        if (pickedUpStatCard) {
            const countEl = pickedUpStatCard.querySelector('div:last-child');
            if (countEl) countEl.textContent = pickedUpCount;
        }
    }

    // Update dashboard stat elements if present
    const invCountEl = document.getElementById('dashInvoiceCount');
    const delCountEl = document.getElementById('dashDeliveryCount');
    if (invCountEl) invCountEl.textContent = AppState.billings.length;
    if (delCountEl) delCountEl.textContent = AppState.deliveries.length;
}

function loadPayrollContent() {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
    <div class="container-fluid employee-payroll">
            <div class="payroll-tabs-grid">
                <div class="payroll-tab-card active" data-tab="employees" onclick="switchPayrollTab('employees')" style="padding:8px 12px;gap:12px;">
                    <div class="tab-card-icon" style="font-size:20px;margin-bottom:0;flex-shrink:0;">👥</div>
                    <div class="tab-card-label" style="margin-bottom:0;flex-shrink:0;">EMPLOYEES</div>
                    <div class="tab-card-value" style="font-size:28px;">${AppState.employees.length}</div>
                </div>
                <div class="payroll-tab-card" data-tab="attendance" onclick="switchPayrollTab('attendance')" style="padding:8px 12px;gap:12px;">
                    <div class="tab-card-icon" style="font-size:20px;margin-bottom:0;flex-shrink:0;">📅</div>
                    <div class="tab-card-label" style="margin-bottom:0;flex-shrink:0;">ATTENDANCE</div>
                    <div class="tab-card-value" style="font-size:28px;">${AppState.employeeAttendance.length}</div>
                </div>
                <div class="payroll-tab-card" data-tab="payrolls" onclick="switchPayrollTab('payrolls')" style="padding:8px 12px;gap:12px;">
                    <div class="tab-card-icon" style="font-size:20px;margin-bottom:0;flex-shrink:0;">💳</div>
                    <div class="tab-card-label" style="margin-bottom:0;flex-shrink:0;">PAYROLLS</div>
                    <div class="tab-card-value" style="font-size:28px;">${AppState.payrolls.length}</div>
                </div>
            </div>

            <div id="employeesTab" class="tab-content active" style="display:block;">
                <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <div>
                        <h2 class="section-title">Employees</h2>
                        <p class="section-subtitle">Manage employee records and roles</p>
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button class="btn btn-secondary" onclick="openRoleSalariesModal()">⚙️ Role Salaries</button>
                        <button class="btn btn-secondary" onclick="openAddEmployeeModal()">+ New Employee</button>
                    </div>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Employee ID</th>
                                <th>Name</th>
                                <th>Role</th>
                                <th>Employment Status</th>
                                <th>Monthly Salary</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="employeesTableBody">
                            <tr class="no-data-row"><td colspan="6">No employees yet. Add one to get started.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="attendanceTab" class="tab-content" style="display:none;">
                <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <div>
                        <h2 class="section-title">Attendance</h2>
                        <p class="section-subtitle">Track employee attendance and absences</p>
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <!-- Week view with navigation built in -->
                    </div>
                </div>
                <div style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;">
                    <div style="display:flex;gap:0.5rem;align-items:center;">
                        <button class="btn btn-secondary" onclick="previousWeek()" style="padding:0.4rem 0.8rem;">&lt; Previous</button>
                        <span id="weekDisplay" style="font-weight:600;min-width:240px;text-align:center;"></span>
                        <button class="btn btn-secondary" onclick="nextWeek()" style="padding:0.4rem 0.8rem;">Next &gt;</button>
                        <button class="btn btn-secondary" onclick="goToCurrentWeek()" style="padding:0.4rem 0.8rem;margin-left:1rem;">Today</button>
                    </div>
                </div>
                <div class="table-container">
                    <table class="data-table" style="width:100%;">
                        <thead id="attendanceTableHead">
                            <tr>
                                <th style="width:13%;text-align:left;">Employee</th>
                            </tr>
                        </thead>
                        <tbody id="attendanceTableBody">
                            <tr class="no-data-row"><td colspan="7">No attendance records yet.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="payrollsTab" class="tab-content" style="display:none;">
                <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <div>
                        <h2 class="section-title">Payrolls</h2>
                        <p class="section-subtitle">Create payroll runs and mark salary payments</p>
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button class="btn btn-secondary" onclick="openCreatePayrollModal()">+ New Payroll</button>
                    </div>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Payroll ID</th>
                                <th>Period</th>
                                <th>Total Amount</th>
                                <th>Processed By</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="payrollsTableBody">
                            <tr class="no-data-row"><td colspan="6">No payroll runs yet.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Initial render
    renderEmployeesTable();
    renderPayrollsTable();
    updatePayrollStats();
}

// Payroll Tab Switching
function switchPayrollTab(tabName) {
    document.querySelectorAll('.payroll-tab-card').forEach(card => card.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
    const card = document.querySelector(`.payroll-tab-card[data-tab="${tabName}"]`);
    const content = document.getElementById(tabName + 'Tab');
    if (card) card.classList.add('active');
    if (content) { content.classList.add('active'); content.style.display = 'block'; }
    if (tabName === 'employees') renderEmployeesTable();
    if (tabName === 'attendance') renderAttendanceTable();
    if (tabName === 'payrolls') renderPayrollsTable();
}

// Update payroll tab card values dynamically
function updatePayrollTabCards() {
    const employeeCard = document.querySelector('.payroll-tab-card[data-tab="employees"] .tab-card-value');
    const attendanceCard = document.querySelector('.payroll-tab-card[data-tab="attendance"] .tab-card-value');
    const payrollsCard = document.querySelector('.payroll-tab-card[data-tab="payrolls"] .tab-card-value');

    if (employeeCard) employeeCard.textContent = AppState.employees.length;
    if (attendanceCard) attendanceCard.textContent = AppState.employeeAttendance.length;
    if (payrollsCard) payrollsCard.textContent = AppState.payrolls.length;
}

// Role Salary Management
function openRoleSalariesModal() {
    const roles = Object.keys(AppState.roleSalaries || {});
    const salaryRows = roles.map(role => `
        <tr>
            <td style="padding:0.5rem;font-weight:600;">${role}</td>
            <td style="padding:0.5rem;">
                <input type="number" id="salary_${role}" class="q-input" value="${AppState.roleSalaries[role]}" min="0" step="0.01" style="width:100%;">
            </td>
            <td style="padding:0.5rem;">
                <button class="btn-sm btn-primary" onclick="updateRoleSalary('${role}')" style="padding:0.4rem 0.8rem;">Update</button>
            </td>
        </tr>
    `).join('');

    const modalContent = `
        <div style="max-height:400px;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#f5f5f5;">
                        <th style="padding:0.5rem;text-align:left;">Role</th>
                        <th style="padding:0.5rem;text-align:left;">Monthly Salary (₱)</th>
                        <th style="padding:0.5rem;text-align:left;">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${salaryRows}
                </tbody>
            </table>
        </div>
        <div style="margin-top:1rem;display:flex;gap:0.5rem;">
            <button class="btn btn-primary" onclick="closeModal()">Done</button>
        </div>
    `;

    const modal = createLargeModal('Manage Role Salaries', modalContent);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function updateRoleSalary(role) {
    const salaryInput = document.getElementById(`salary_${role}`);
    const newSalary = parseFloat(salaryInput.value);
    if (newSalary && newSalary >= 0) {
        showLoading('Updating salary...');
        AppState.roleSalaries[role] = newSalary;

        // Update all employees with this role to the new salary
        (AppState.employees || []).forEach(emp => {
            if (emp.role === role) {
                emp.salary = newSalary;
            }
        });

        syncDataToFirestore().then(() => {
            hideLoading();
            showMessage('Success', `Salary for ${role} updated to ₱${newSalary.toFixed(2)}. ${(AppState.employees || []).filter(e => e.role === role).length} employee(s) updated.`, 'success');
            renderEmployeesTable();
        }).catch(err => {
            hideLoading();
            showMessage('Error', 'Failed to update salary: ' + err.message, 'error');
        });
    } else {
        showMessage('Error', 'Please enter a valid salary amount', 'error');
    }
}

// Employees
function renderEmployeesTable() {
    const tbody = document.getElementById('employeesTableBody');
    if (!tbody) return;
    if (!AppState.employees || AppState.employees.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="6">No employees yet. Add one to get started.</td></tr>';
        return;
    }

    tbody.innerHTML = AppState.employees.map(emp => `
            <tr>
                <td style="padding:0.5rem;">${emp.employeeId}</td>
                <td style="padding:0.5rem;">${emp.name}</td>
                <td style="padding:0.5rem;">${emp.role}</td>
                <td style="padding:0.5rem;"><span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:${emp.status === 'terminated' ? '#FFEBEE' : '#E8F5E9'};color:${emp.status === 'terminated' ? '#C62828' : '#2E7D32'};border-radius:3px;">${emp.status || 'active'}</span></td>
                <td style="padding:0.5rem;">₱${(emp.salary || 0).toFixed(2)}</td>
                <td style="padding:0.5rem;">
                    <button class="action-btn action-btn-view" onclick="viewEmployee('${emp.employeeId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">View</button>
                    ${emp.status !== 'terminated' ? `<button class="action-btn action-btn-edit" onclick="openEditEmployeeModal('${emp.employeeId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">Edit</button>` : ''}
                    ${emp.status === 'active' ? `<button class="action-btn action-btn-delete" onclick="confirmTerminateEmployee('${emp.employeeId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Terminate</button>` : `<button class="action-btn action-btn-edit" onclick="confirmRehireEmployee('${emp.employeeId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;background:#27AE60;color:white;margin-right:0.25rem;">Rehire</button>` + (emp.status === 'terminated' ? `<button class="action-btn action-btn-delete" onclick="confirmDeleteEmployee('${emp.employeeId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;background:#c62828;color:white;">Delete</button>` : '')}
                </td>
            </tr>
        `).join('');
}

function openAddEmployeeModal() {
    const roleOptions = Object.keys(AppState.roleSalaries || {});
    const modalContent = `
            <form id="addEmployeeForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Full Name</label>
                        <input type="text" id="emp_name" class="q-input" required>
                    </div>
                    <div class="form-group">
                        <label>Role</label>
                        <select id="emp_role" class="q-input" required onchange="updateSalaryFromRole()">
                            <option value="">-- Select Role --</option>
                            ${roleOptions.map(role => `<option value="${role}">${role}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Monthly Salary (₱)</label>
                        <input type="number" id="emp_salary" class="q-input" min="0" step="0.01" required placeholder="Auto-populated from role">
                    </div>
                    <div class="form-group">
                        <label>Start Date</label>
                        <input type="date" id="emp_start" class="q-input">
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn-primary">Add Employee</button>
                </div>
            </form>
        `;

    const modal = createLargeModal('Add Employee', modalContent);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    document.getElementById('addEmployeeForm').addEventListener('submit', (e) => {
        e.preventDefault();
        createEmployee();
    });
}

function updateSalaryFromRole() {
    const roleSelect = document.getElementById('emp_role');
    const salaryInput = document.getElementById('emp_salary');
    const role = roleSelect.value;
    if (role && AppState.roleSalaries[role]) {
        salaryInput.value = AppState.roleSalaries[role];
    }
}

async function createEmployee() {
    showLoading('Adding employee...');
    try {
        const name = document.getElementById('emp_name')?.value || '';
        const role = document.getElementById('emp_role')?.value || 'Staff';
        const salary = parseFloat(document.getElementById('emp_salary')?.value) || 0;
        const start = document.getElementById('emp_start')?.value || new Date().toLocaleDateString();

        if (!name) {
            hideLoading();
            showMessage('Validation Error', 'Please enter employee name', 'warning');
            return;
        }

        if (salary <= 0) {
            hideLoading();
            showMessage('Validation Error', 'Please enter a valid salary', 'warning');
            return;
        }

        const emp = {
            employeeId: `EMP-${Date.now()}`,
            name: name,
            role: role,
            salary: salary,
            startDate: start,
            status: 'active'
        };

        AppState.employees.push(emp);
        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderEmployeesTable();
        renderPayrollsTable();
        updatePayrollStats();
        showMessage('Success', 'Employee ' + emp.employeeId + ' added successfully!', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error creating employee:', error);
        showMessage('Error', 'Failed to add employee: ' + error.message, 'error');
    }
}

function viewEmployee(employeeId) {
    const emp = AppState.employees.find(e => e.employeeId === employeeId);
    if (!emp) return;
    const content = `
            <div>
                <p><strong>ID:</strong> ${emp.employeeId}</p>
                <p><strong>Name:</strong> ${emp.name}</p>
                <p><strong>Role:</strong> ${emp.role}</p>
                <p><strong>Status:</strong> ${formatStatus(emp.status)}</p>
                <p><strong>Salary:</strong> ₱${(emp.salary || 0).toFixed(2)}</p>
                <p><strong>Start Date:</strong> ${emp.startDate || '-'}</p>
            </div>
        `;
    const modal = createModal('Employee - ' + emp.employeeId, content);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function openEditEmployeeModal(employeeId) {
    const emp = AppState.employees.find(e => e.employeeId === employeeId);
    if (!emp) return;
    const roleOptions = Object.keys(AppState.roleSalaries || {});
    const modalContent = `
            <form id="editEmployeeForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Full Name</label>
                        <input type="text" id="edit_emp_name" class="q-input" value="${emp.name}">
                    </div>
                    <div class="form-group">
                        <label>Role</label>
                        <select id="edit_emp_role" class="q-input" onchange="updateEditSalaryFromRole('${employeeId}')">
                            <option value="${emp.role}">${emp.role}</option>
                            ${roleOptions.map(role => role !== emp.role ? `<option value="${role}">${role}</option>` : '').join('')}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Monthly Salary (₱)</label>
                        <input type="number" id="edit_emp_salary" class="q-input" min="0" step="0.01" value="${emp.salary}">
                    </div>
                    <div class="form-group">
                        <label>Status</label>
                        <select id="edit_emp_status" class="q-input"><option value="active">Active</option><option value="on-leave">On Leave</option><option value="terminated">Terminated</option></select>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn-primary">Save Changes</button>
                </div>
            </form>
        `;

    const modal = createLargeModal('Edit Employee - ' + emp.employeeId, modalContent);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    // set current status
    setTimeout(() => { const sel = document.getElementById('edit_emp_status'); if (sel) sel.value = emp.status || 'active'; }, 50);

    document.getElementById('editEmployeeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        emp.name = document.getElementById('edit_emp_name')?.value || emp.name;
        emp.role = document.getElementById('edit_emp_role')?.value || emp.role;
        emp.salary = parseFloat(document.getElementById('edit_emp_salary')?.value) || emp.salary;
        emp.status = document.getElementById('edit_emp_status')?.value || emp.status;
        await syncDataToFirestore();
        closeModal();
        renderEmployeesTable();
        updatePayrollStats();
        showMessage('Success', 'Employee updated', 'success');
    });
}

function updateEditSalaryFromRole(employeeId) {
    const roleSelect = document.getElementById('edit_emp_role');
    const salaryInput = document.getElementById('edit_emp_salary');
    const role = roleSelect.value;
    if (role && AppState.roleSalaries[role]) {
        salaryInput.value = AppState.roleSalaries[role];
    }
}

function confirmTerminateEmployee(employeeId) {
    const emp = AppState.employees.find(e => e.employeeId === employeeId);
    if (!emp) return;
    const modal = createModal('Terminate Employee', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #e74c3c;">⚠️ Terminate Employee?</p>
            <p style="margin-bottom: 1rem; color: #333;">Employee: <strong>${emp.name}</strong></p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">This action cannot be undone. The employee will be marked as terminated.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="terminateEmployeeConfirmed('${employeeId}')" style="padding: 0.75rem 1.5rem; background: #e74c3c;">Terminate</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function terminateEmployeeConfirmed(employeeId) {
    showLoading('Terminating employee...');
    try {
        const emp = AppState.employees.find(e => e.employeeId === employeeId);
        if (!emp) return;
        emp.status = 'terminated';
        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderEmployeesTable();
        renderPayrollsTable();
        updatePayrollStats();
        showMessage('Success', 'Employee terminated successfully', 'success');
    } catch (error) {
        hideLoading();
        showMessage('Error', 'Failed to terminate employee: ' + error.message, 'error');
    }
}

async function terminateEmployee(employeeId) {
    confirmTerminateEmployee(employeeId);
}

function confirmRehireEmployee(employeeId) {
    const emp = AppState.employees.find(e => e.employeeId === employeeId);
    if (!emp) return;
    const modal = createModal('Rehire Employee', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #27AE60;">✓ Rehire Employee?</p>
            <p style="margin-bottom: 1rem; color: #333;">Employee: <strong>${emp.name}</strong></p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">This will restore the employee status to active.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="rehireEmployeeConfirmed('${employeeId}')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Rehire</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function confirmDeleteEmployee(employeeId) {
    const emp = AppState.employees.find(e => e.employeeId === employeeId);
    if (!emp) return;
    const modal = createModal('Delete Employee', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #c62828;">🗑️ Delete Employee?</p>
            <p style="margin-bottom: 1rem; color: #333;">Employee: <strong>${emp.name}</strong></p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">This will permanently remove the employee record from the system.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="deleteEmployeeConfirmed('${employeeId}')" style="padding: 0.75rem 1.5rem; background: #c62828; color: white;">Delete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function deleteEmployeeConfirmed(employeeId) {
    showLoading('Deleting employee...');
    try {
        // Remove employee from main list
        AppState.employees = (AppState.employees || []).filter(e => e.employeeId !== employeeId);

        // Also remove from any payroll selections
        if (window.payrollSelectedEmployees) {
            window.payrollSelectedEmployees = (window.payrollSelectedEmployees || []).filter(id => id !== employeeId);
            updatePayrollEmployeeList();
        }

        // Cascade-remove employee from payrolls: remove entries, recompute totals, drop empty payroll runs
        if (AppState.payrolls && AppState.payrolls.length > 0) {
            AppState.payrolls = (AppState.payrolls || []).map(p => {
                p.entries = (p.entries || []).filter(en => en.employeeId !== employeeId);
                p.totalAmount = (p.entries || []).reduce((s, x) => s + (x.salary || 0), 0);
                return p;
            }).filter(p => (p.entries || []).length > 0);
        }

        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderEmployeesTable();
        renderPayrollsTable();
        updatePayrollStats();
        showMessage('Success', 'Employee deleted successfully', 'success');
    } catch (error) {
        hideLoading();
        showMessage('Error', 'Failed to delete employee: ' + error.message, 'error');
    }
}

async function rehireEmployeeConfirmed(employeeId) {
    showLoading('Rehiring employee...');
    try {
        const emp = AppState.employees.find(e => e.employeeId === employeeId);
        if (!emp) return;
        emp.status = 'active';
        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderEmployeesTable();
        renderPayrollsTable();
        updatePayrollStats();
        showMessage('Success', 'Employee rehired successfully', 'success');
    } catch (error) {
        hideLoading();
        showMessage('Error', 'Failed to rehire employee: ' + error.message, 'error');
    }
}

// Payrolls
function renderPayrollsTable() {
    const tbody = document.getElementById('payrollsTableBody');
    if (!tbody) return;
    if (!AppState.payrolls || AppState.payrolls.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="6">No payroll runs yet.</td></tr>';
        return;
    }

    tbody.innerHTML = AppState.payrolls.map(p => `
            <tr>
                <td style="padding:0.5rem;">${p.payrollId}</td>
                <td style="padding:0.5rem;">${p.period || '-'}</td>
                <td style="padding:0.5rem;">₱${(p.totalAmount || 0).toFixed(2)}</td>
                <td style="padding:0.5rem;">${p.processedBy || '-'}</td>
                <td style="padding:0.5rem;"><span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#E8F5E9;color:#2E7D32;border-radius:3px;">${p.status || 'pending'}</span></td>
                <td style="padding:0.5rem;">
                    <button class="action-btn action-btn-view" onclick="viewPayroll('${p.payrollId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">View</button>
                    ${p.status !== 'paid' ? `<button class="action-btn action-btn-edit" onclick="confirmProcessPayroll('${p.payrollId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Process Payment</button>` : ''}
                    <button class="action-btn action-btn-delete" onclick="confirmDeletePayroll('${p.payrollId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-left:0.25rem;background:#c62828;color:white;">Delete</button>
                </td>
            </tr>
        `).join('');
}

function confirmDeletePayroll(payrollId) {
    const p = (AppState.payrolls || []).find(x => x.payrollId === payrollId);
    if (!p) return;
    const modal = createModal('Delete Payroll', `
        <div style="padding:1rem;text-align:center;">
            <p style="font-size:1rem;color:#c62828;margin-bottom:0.5rem;">🗑️ Delete payroll ${p.payrollId}?</p>
            <p style="color:var(--text-muted);margin-bottom:1rem;">Period: <strong>${p.period || '-'}</strong><br/>Total: <strong>₱${(p.totalAmount || 0).toFixed(2)}</strong></p>
            <div style="display:flex;gap:0.5rem;justify-content:center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding:0.6rem 1rem;">Cancel</button>
                <button class="btn btn-primary" onclick="deletePayrollConfirmed('${payrollId}')" style="padding:0.6rem 1rem;background:#c62828;color:white;">Delete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function deletePayrollConfirmed(payrollId) {
    showLoading('Deleting payroll...');
    try {
        AppState.payrolls = (AppState.payrolls || []).filter(p => p.payrollId !== payrollId);
        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderPayrollsTable();
        updatePayrollStats();
        showMessage('Success', 'Payroll deleted', 'success');
    } catch (err) {
        hideLoading();
        showMessage('Error', 'Failed to delete payroll: ' + (err.message || err), 'error');
    }
}

function openCreatePayrollModal() {
    if (!AppState.employees || AppState.employees.length === 0) {
        showMessage('No Employees', 'Add employees before creating payroll runs', 'warning');
        return;
    }

    // Auto-generate payroll period based on current month
    const now = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const autoPayrollPeriod = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;

    const modalContent = `
            <form id="createPayrollForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Payroll Period</label>
                        <input type="text" id="pay_period" class="q-input" value="${autoPayrollPeriod}" readonly style="background-color: #f5f5f5; cursor: not-allowed;">
                    </div>
                    <div class="form-group">
                        <label>Processed By</label>
                        <input type="text" id="pay_processedBy" class="q-input" value="${AppState.currentUser?.username || ''}">
                    </div>
                </div>
                <div style="margin-top:1rem;">
                    <h4>Select Employees</h4>
                    <div style="display:flex;gap:0.5rem;margin-bottom:1rem;">
                        <select id="pay_emp_select" class="q-input" style="flex:1;">
                            <option value="">-- Select Employee --</option>
                            ${AppState.employees.filter(emp => emp.status === 'active' || !emp.status).map(emp => `
                                <option value="${emp.employeeId}">${emp.employeeId} - ${emp.name} (₱${(emp.salary || 0).toFixed(2)})</option>
                            `).join('')}
                        </select>
                        <button type="button" class="btn-secondary" onclick="addEmployeeToPayroll()" style="padding:0.5rem 1rem;">Add</button>
                    </div>
                    <h4>Included Employees</h4>
                    <div id="pay_emp_list" style="border:1px solid var(--border);padding:0.5rem;border-radius:6px;min-height:100px;max-height:200px;overflow:auto;background:#f9f9f9;">
                        <p style="color:#999;text-align:center;">No employees selected yet</p>
                    </div>
                </div>
                <div class="form-actions" style="margin-top:1rem;">
                    <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn-primary">Create Payroll</button>
                </div>
            </form>
        `;

    const modal = createLargeModal('Create Payroll Run', modalContent);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    // Initialize empty payroll employee selection
    window.payrollSelectedEmployees = [];
    updatePayrollEmployeeList();

    document.getElementById('createPayrollForm').addEventListener('submit', (e) => {
        e.preventDefault();
        createPayroll();
    });
}

function addEmployeeToPayroll() {
    const select = document.getElementById('pay_emp_select');
    const selectedId = select?.value;

    if (!selectedId) {
        showMessage('Select Employee', 'Please select an employee from the dropdown', 'warning');
        return;
    }

    // Check if already selected
    if (window.payrollSelectedEmployees.includes(selectedId)) {
        showMessage('Already Selected', 'This employee is already in the payroll', 'warning');
        return;
    }

    window.payrollSelectedEmployees.push(selectedId);
    select.value = '';
    updatePayrollEmployeeList();
}

function removeEmployeeFromPayroll(employeeId) {
    window.payrollSelectedEmployees = window.payrollSelectedEmployees.filter(id => id !== employeeId);
    updatePayrollEmployeeList();
}

function updatePayrollEmployeeList() {
    const listDiv = document.getElementById('pay_emp_list');
    if (!listDiv) return;

    if (window.payrollSelectedEmployees.length === 0) {
        listDiv.innerHTML = '<p style="color:#999;text-align:center;">No employees selected yet</p>';
        return;
    }

    listDiv.innerHTML = window.payrollSelectedEmployees.map(eid => {
        const emp = AppState.employees.find(e => e.employeeId === eid);
        return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;border-bottom:1px solid #ddd;">
                <span>${eid} - ${emp?.name} (₱${(emp?.salary || 0).toFixed(2)})</span>
                <button type="button" class="btn-sm" onclick="removeEmployeeFromPayroll('${eid}')" style="padding:0.25rem 0.5rem;background:#e74c3c;color:white;border:none;border-radius:3px;cursor:pointer;font-size:0.75rem;">Remove</button>
            </div>
        `;
    }).join('');
}

async function createPayroll() {
    showLoading('Creating payroll...');
    try {
        const period = document.getElementById('pay_period')?.value || '';
        const processedBy = document.getElementById('pay_processedBy')?.value || AppState.currentUser?.username || 'system';
        const selected = window.payrollSelectedEmployees || [];

        if (!period || selected.length === 0) {
            hideLoading();
            showMessage('Validation Error', 'Please select at least one employee', 'warning');
            return;
        }

        // Calculate entries with attendance-based deductions
        const entries = selected.map(eid => {
            const emp = AppState.employees.find(x => x.employeeId === eid);
            let baseSalary = emp?.salary || 0;

            // Count absences in this payroll period and deduct
            const periodMonth = period.split(' ')[0]; // e.g., "Jan"
            const periodYear = period.split(' ')[1]; // e.g., "2026"
            const absenceCount = (AppState.employeeAttendance || []).filter(att => {
                const [attMonth, attDay, attYear] = att.date.split('-').reverse();
                const monthNames = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
                const monthIndex = monthNames.indexOf(attMonth);
                const attMonthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthIndex];
                return att.employeeId === eid && att.status === 'absent' && attMonthName === periodMonth && attYear === periodYear;
            }).length;

            // Deduct per absence (daily rate = monthly salary / 22 working days)
            const dailyRate = baseSalary / 22;
            const deduction = absenceCount * dailyRate;
            const finalSalary = baseSalary - deduction;

            return {
                employeeId: eid,
                name: emp?.name || '',
                salary: finalSalary,
                baseSalary: baseSalary,
                absences: absenceCount,
                deduction: deduction,
                status: 'pending'
            };
        });

        const total = entries.reduce((s, x) => s + (x.salary || 0), 0);

        const payroll = {
            payrollId: `PAY-${Date.now()}`,
            period: period,
            entries: entries,
            totalAmount: total,
            processedBy: processedBy,
            status: 'pending',
            createdDate: new Date().toLocaleDateString()
        };

        AppState.payrolls.push(payroll);
        await syncDataToFirestore();
        window.payrollSelectedEmployees = [];
        hideLoading();
        closeModal();
        renderPayrollsTable();
        updatePayrollStats();
        showMessage('Success', 'Payroll ' + payroll.payrollId + ' created successfully!', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error creating payroll:', error);
        showMessage('Error', 'Failed to create payroll: ' + error.message, 'error');
    }
}

function viewPayroll(payrollId) {
    const p = AppState.payrolls.find(x => x.payrollId === payrollId);
    if (!p) return;
    const rows = p.entries.map(en => `<tr><td>${en.employeeId}</td><td>${en.name}</td><td>₱${(en.baseSalary || en.salary || 0).toFixed(2)}</td><td>${en.absences || 0}</td><td>₱${(en.deduction || 0).toFixed(2)}</td><td>₱${(en.salary || 0).toFixed(2)}</td><td>${en.status}</td></tr>`).join('');
    const content = `
            <div>
                <p><strong>Payroll:</strong> ${p.payrollId}</p>
                <p><strong>Period:</strong> ${p.period}</p>
                <p><strong>Total:</strong> ₱${(p.totalAmount || 0).toFixed(2)}</p>
                <p><strong>Status:</strong> ${formatStatus(p.status)}</p>
                <div style="margin-top:1rem;">
                    <h4>Entries</h4>
                    <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;margin-top:0.5rem;font-size:0.85rem;"><thead><tr><th>Emp ID</th><th>Name</th><th>Base Salary</th><th>Absences</th><th>Deduction</th><th>Final Salary</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
                    </div>
                </div>
                <div style="margin-top:1rem;display:flex;gap:0.5rem;">
                    ${p.status !== 'paid' ? `<button class="btn btn-primary" onclick="confirmProcessPayroll('${p.payrollId}')">Process Payment</button>` : ''}
                    <button class="btn btn-secondary" onclick="closeModal()">Close</button>
                </div>
            </div>
        `;
    const modal = createModal('Payroll - ' + p.payrollId, content);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

function confirmProcessPayroll(payrollId) {
    const p = AppState.payrolls.find(x => x.payrollId === payrollId);
    if (!p) return;
    const modal = createModal('Process Payroll', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Process payroll <strong>${payrollId}</strong>?</p>
            <p style="margin-bottom: 0.5rem; color: #666; font-size: 0.9rem;">Employees: ${p.entries ? p.entries.length : 0}</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">Total Amount: <strong>₱${(p.totalAmount || 0).toFixed(2)}</strong></p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="processPayrollConfirmed('${payrollId}')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Process</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function processPayrollConfirmed(payrollId) {
    showLoading('Processing payroll...');
    try {
        const p = AppState.payrolls.find(x => x.payrollId === payrollId);
        if (!p) return;
        p.status = 'paid';
        p.paidDate = new Date().toLocaleDateString();
        p.entries.forEach(e => e.status = 'paid');
        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderPayrollsTable();
        updatePayrollStats();
        showMessage('Success', 'Payroll processed and marked as paid', 'success');
    } catch (error) {
        hideLoading();
        showMessage('Error', 'Failed to process payroll: ' + error.message, 'error');
    }
}

async function processPayroll(payrollId) {
    confirmProcessPayroll(payrollId);
}

function updatePayrollStats() {
    const empCountEl = document.getElementById('dashEmployeeCount');
    const payrollCountEl = document.getElementById('dashPayrollCount');
    if (empCountEl) empCountEl.textContent = AppState.employees.length;
    if (payrollCountEl) payrollCountEl.textContent = AppState.payrolls.length;
}

// Attendance
let currentWeekStart = null;

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function getWeekEnd(date) {
    const start = getWeekStart(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 5); // Saturday
    return end;
}

function formatDateWithDay(date) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date(date);
    const dayName = days[d.getDay()];
    const dayNum = d.getDate();
    return `${dayName}, ${dayNum}`;
}

function formatDateYMD(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function renderAttendanceTableHeaders() {
    const thead = document.getElementById('attendanceTableHead');
    if (!thead) return;

    if (!currentWeekStart) currentWeekStart = getWeekStart(new Date());

    const headerRow = thead.querySelector('tr');
    headerRow.innerHTML = '<th style="width:13%;text-align:left;">Employee</th>';

    for (let i = 0; i < 6; i++) {
        const cellDate = new Date(currentWeekStart);
        cellDate.setDate(cellDate.getDate() + i);
        const dateHeader = formatDateWithDay(cellDate);
        const th = document.createElement('th');
        th.style.cssText = 'width:15%;text-align:center;';
        th.textContent = dateHeader;
        headerRow.appendChild(th);
    }
}

function previousWeek() {
    if (!currentWeekStart) currentWeekStart = new Date();
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    renderAttendanceTable();
}

function nextWeek() {
    if (!currentWeekStart) currentWeekStart = new Date();
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    renderAttendanceTable();
}

function goToCurrentWeek() {
    currentWeekStart = getWeekStart(new Date());
    renderAttendanceTable();
}

function renderAttendanceTable() {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;

    if (!currentWeekStart) currentWeekStart = getWeekStart(new Date());

    const displayElement = document.getElementById('weekDisplay');
    if (displayElement) {
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const month = months[currentWeekStart.getMonth()];
        const year = currentWeekStart.getFullYear();
        displayElement.textContent = `${month} ${year}`;
    }

    renderAttendanceTableHeaders();

    const activeEmployees = (AppState.employees || []).filter(e => e.status === 'active' || !e.status);
    if (activeEmployees.length === 0) {
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">No active employees to mark attendance.</td></tr>';
        return;
    }

    // Ensure employeeAttendance is initialized
    if (!AppState.employeeAttendance) AppState.employeeAttendance = [];

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    try {
        tbody.innerHTML = activeEmployees.map(emp => {
            // Safely get employee properties with defaults
            const employeeName = (emp.name || emp.employeeName || 'Unknown Employee');
            const employeeId = (emp.employeeId || emp.id || '');

            // Skip if no valid employee ID
            if (!employeeId) return '';

            const dayCells = days.map((day, idx) => {
                const cellDate = new Date(currentWeekStart);
                cellDate.setDate(cellDate.getDate() + idx);
                const dateStr = formatDateYMD(cellDate);

                const record = AppState.employeeAttendance.find(a =>
                    a.employeeId === employeeId && a.date === dateStr
                );

                const isPresent = record?.status === 'present';

                return `<td style="padding:0.5rem;text-align:center;">
                    <input type="checkbox" 
                        ${isPresent ? 'checked' : ''} 
                        data-emp-id="${employeeId}" 
                        data-date="${dateStr}"
                        onchange="handleAttendanceToggle(this)"
                        style="width:20px;height:20px;cursor:pointer;">
                </td>`;
            }).join('');

            return `<tr>
                <td style="padding:0.5rem;font-weight:600;">${employeeName}</td>
                ${dayCells}
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('Error rendering attendance table:', err);
        tbody.innerHTML = '<tr class="no-data-row"><td colspan="7">Error loading attendance data</td></tr>';
    }
}

function handleAttendanceToggle(checkbox) {
    try {
        const employeeId = checkbox.getAttribute('data-emp-id');
        const dateStr = checkbox.getAttribute('data-date');
        const isPresent = checkbox.checked;

        if (!employeeId || !dateStr) {
            console.error('Missing employeeId or dateStr', { employeeId, dateStr });
            return;
        }

        toggleDayAttendance(employeeId, dateStr, isPresent);
    } catch (err) {
        console.error('Error toggling attendance:', err);
    }
}

async function toggleDayAttendance(employeeId, dateStr, isPresent) {
    // Ensure employeeAttendance is initialized
    if (!AppState.employeeAttendance) AppState.employeeAttendance = [];

    // Look up employee name from AppState
    const employee = AppState.employees.find(e => e.employeeId === employeeId);
    const employeeName = employee ? employee.name : 'Unknown';

    let record = AppState.employeeAttendance.find(a =>
        a.employeeId === employeeId && a.date === dateStr
    );

    if (record) {
        record.status = isPresent ? 'present' : 'absent';
    } else {
        AppState.employeeAttendance.push({
            id: `ATT-${Date.now()}`,
            date: dateStr,
            employeeId: employeeId,
            employeeName: employeeName,
            status: isPresent ? 'present' : 'absent',
            notes: '',
            createdDate: new Date().toLocaleDateString()
        });
    }

    // Debounce: batch rapid toggles into single sync
    pendingAttendanceChanges.add(`${employeeId}-${dateStr}`);

    clearTimeout(attendanceSyncTimer);
    attendanceSyncTimer = setTimeout(async () => {
        try {
            showLoading('Saving attendance...');
            await syncDataToFirestore();
            hideLoading();
            renderAttendanceTable();
            pendingAttendanceChanges.clear();
        } catch (err) {
            hideLoading();
            console.error('Error saving attendance:', err);
            showMessage('Error', 'Failed to save attendance: ' + (err.message || err), 'error');
            renderAttendanceTable();  // Re-render to reset checkbox state on error
        }
    }, 300);  // Batch within 300ms
}

// Removed: openAddAttendanceModal - no longer needed with weekly grid view

function _oldOpenAddAttendanceModal() {
    const activeEmployees = (AppState.employees || []).filter(e => e.status === 'active' || !e.status);
    if (activeEmployees.length === 0) {
        showMessage('No Employees', 'Add active employees before recording attendance', 'warning');
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const modalContent = `
        <form id="addAttendanceForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Date *</label>
                    <input type="date" id="att_date" class="q-input" value="${today}" required>
                </div>
                <div class="form-group">
                    <label>Employee *</label>
                    <select id="att_employee" class="q-input" required>
                        <option value="">-- Select Employee --</option>
                        ${activeEmployees.map(emp => `<option value="${emp.employeeId}" data-name="${emp.name}|${emp.salary}">${emp.employeeId} - ${emp.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                        <input type="checkbox" id="att_status" style="width:18px;height:18px;cursor:pointer;">
                        <span>Present</span>
                    </label>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Notes (optional)</label>
                    <textarea id="att_notes" class="q-input" placeholder="e.g., Sick leave, Emergency" style="min-height:80px;"></textarea>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn-primary">Add Attendance</button>
            </div>
        </form>
    `;

    const modal = createModal('Record Attendance', modalContent);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    document.getElementById('addAttendanceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoading('Recording attendance...');
        try {
            const empId = document.getElementById('att_employee').value;
            const empOption = document.querySelector(`#att_employee option[value="${empId}"]`);
            const [empName, salary] = empOption?.getAttribute('data-name').split('|') || ['', '0'];

            const attendance = {
                id: `ATT-${Date.now()}`,
                date: document.getElementById('att_date').value,
                employeeId: empId,
                employeeName: empName,
                status: document.getElementById('att_status').checked ? 'present' : 'absent',
                notes: document.getElementById('att_notes').value || '',
                createdDate: new Date().toLocaleDateString()
            };

            AppState.employeeAttendance.push(attendance);
            await syncDataToFirestore();
            hideLoading();
            closeModal();
            renderAttendanceTable();
            showMessage('Success', 'Attendance recorded successfully', 'success');
        } catch (err) {
            hideLoading();
            showMessage('Error', 'Failed to record attendance: ' + (err.message || err), 'error');
        }
    });
}

function editAttendance(attendanceId) {
    const att = (AppState.employeeAttendance || []).find(a => a.id === attendanceId);
    if (!att) return;

    const modalContent = `
        <form id="editAttendanceForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Date *</label>
                    <input type="date" id="edit_att_date" class="q-input" value="${att.date}" required>
                </div>
                <div class="form-group">
                    <label>Employee *</label>
                    <input type="text" class="q-input" value="${att.employeeName}" disabled style="background:#f5f5f5;">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                        <input type="checkbox" id="edit_att_status" ${att.status === 'present' ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;">
                        <span>Present</span>
                    </label>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Notes (optional)</label>
                    <textarea id="edit_att_notes" class="q-input" placeholder="e.g., Sick leave" style="min-height:80px;">${att.notes || ''}</textarea>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn-primary">Save Changes</button>
            </div>
        </form>
    `;

    const modal = createModal('Edit Attendance', modalContent);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    document.getElementById('editAttendanceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoading('Saving attendance...');
        try {
            att.date = document.getElementById('edit_att_date').value;
            att.status = document.getElementById('edit_att_status').checked ? 'present' : 'absent';
            att.notes = document.getElementById('edit_att_notes').value || '';

            await syncDataToFirestore();
            hideLoading();
            closeModal();
            renderAttendanceTable();
            showMessage('Success', 'Attendance updated successfully', 'success');
        } catch (err) {
            hideLoading();
            showMessage('Error', 'Failed to update attendance: ' + (err.message || err), 'error');
        }
    });
}

function toggleAttendanceStatus(attendanceId, isPresent) {
    const att = (AppState.employeeAttendance || []).find(a => a.id === attendanceId);
    if (!att) return;
    att.status = isPresent ? 'present' : 'absent';
    syncDataToFirestore().then(() => {
        renderAttendanceTable();
    });
}

function confirmDeleteAttendance(attendanceId) {
    const att = (AppState.employeeAttendance || []).find(a => a.id === attendanceId);
    if (!att) return;
    const modal = createModal('Delete Attendance Record', `
        <div style="padding:1rem;text-align:center;">
            <p style="font-size:1rem;color:#c62828;margin-bottom:0.5rem;">🗑️ Delete attendance record?</p>
            <p style="color:var(--text-muted);margin-bottom:1rem;">Date: <strong>${att.date}</strong><br/>Employee: <strong>${att.employeeName}</strong></p>
            <div style="display:flex;gap:0.5rem;justify-content:center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding:0.6rem 1rem;">Cancel</button>
                <button class="btn btn-primary" onclick="deleteAttendanceConfirmed('${attendanceId}')" style="padding:0.6rem 1rem;background:#c62828;color:white;">Delete</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function deleteAttendanceConfirmed(attendanceId) {
    showLoading('Deleting attendance record...');
    try {
        AppState.employeeAttendance = (AppState.employeeAttendance || []).filter(a => a.id !== attendanceId);
        await syncDataToFirestore();
        hideLoading();
        closeModal();
        renderAttendanceTable();
        showMessage('Success', 'Attendance record deleted', 'success');
    } catch (err) {
        hideLoading();
        showMessage('Error', 'Failed to delete record: ' + (err.message || err), 'error');
    }
}

function loadReportsContent() {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
        <div style="padding:0.5rem;overflow-x:hidden;">
            <!-- Key Metrics (4-column grid) -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem;margin-bottom:1.5rem;">
                <div style="background:white;padding:1rem;border-left:4px solid var(--gold-primary);border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                    <div style="font-size:0.8rem;color:var(--text-muted);font-weight:500;margin-bottom:0.5rem;">Total Orders</div>
                    <div style="font-size:2rem;font-weight:700;color:var(--navy-dark);" id="rptTotalOrders">0</div>
                </div>
                <div style="background:white;padding:1rem;border-left:4px solid var(--gold-primary);border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                    <div style="font-size:0.8rem;color:var(--text-muted);font-weight:500;margin-bottom:0.5rem;">Total Revenue</div>
                    <div style="font-size:2rem;font-weight:700;color:var(--navy-dark);" id="rptTotalRevenue">₱0.00</div>
                </div>
                <div style="background:white;padding:1rem;border-left:4px solid var(--gold-primary);border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                    <div style="font-size:0.8rem;color:var(--text-muted);font-weight:500;margin-bottom:0.5rem;">Inventory Value</div>
                    <div style="font-size:2rem;font-weight:700;color:var(--navy-dark);" id="rptInventoryValue">₱0.00</div>
                </div>
                <div style="background:white;padding:1rem;border-left:4px solid var(--gold-primary);border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                    <div style="font-size:0.8rem;color:var(--text-muted);font-weight:500;margin-bottom:0.5rem;">Total Payrolls</div>
                    <div style="font-size:2rem;font-weight:700;color:var(--navy-dark);" id="rptTotalPayrolls">0</div>
                </div>
            </div>

            <!-- Charts Section -->
            <div style="background:white;padding:1rem;border-radius:6px;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <div id="rptCharts" style="font-size:0.9rem;line-height:1.8;color:var(--text-muted);">No data available</div>
            </div>

            <!-- Sales Report Generation -->
            <div style="background:white;padding:1rem;border-radius:6px;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <h3 style="margin:0 0 0.75rem 0;color:var(--navy-dark);font-size:1rem;font-weight:600;">Generate Sales Report</h3>
                <p style="margin:0 0 0.75rem 0;font-size:0.85rem;color:var(--text-muted);">Filter invoices by date range and export as CSV</p>
                <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
                    <input type="date" id="rpt_start" style="padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;background:white;color:var(--text-muted);">
                    <input type="date" id="rpt_end" style="padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;background:white;color:var(--text-muted);">
                    <button class="action-btn action-btn-view" onclick="generateSalesReport()" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-left:0.25rem;">Generate Report</button>
                    <button class="action-btn action-btn-edit" onclick="exportInvoicesCSV()" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Export CSV</button>
                </div>
            </div>

            <!-- Recent Data Tabs (Card Style) -->
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;margin-bottom:1.5rem;">
                <div class="report-tab-card active" data-tab="invoices" onclick="switchReportTab('invoices')" style="cursor:pointer;background:white;border:3px solid #F0EBE3;border-radius:16px;padding:8px 12px;text-align:center;transition:all 0.3s ease;box-shadow:0 2px 8px rgba(44,54,57,0.06);display:flex;align-items:center;justify-content:center;gap:12px;">
                    <div style="font-size:20px;flex-shrink:0;">📄</div>
                    <div style="font-size:13px;font-weight:700;color:#576F72;text-transform:uppercase;letter-spacing:0.5px;flex-shrink:0;">Recent Invoices</div>
                    <div id="rptInvoicesCount" style="font-size:28px;font-weight:700;color:var(--navy-dark);">0</div>
                </div>
                <div class="report-tab-card" data-tab="deliveries" onclick="switchReportTab('deliveries')" style="cursor:pointer;background:white;border:3px solid #F0EBE3;border-radius:16px;padding:8px 12px;text-align:center;transition:all 0.3s ease;box-shadow:0 2px 8px rgba(44,54,57,0.06);display:flex;align-items:center;justify-content:center;gap:12px;">
                    <div style="font-size:20px;flex-shrink:0;">🚚</div>
                    <div style="font-size:13px;font-weight:700;color:#576F72;text-transform:uppercase;letter-spacing:0.5px;flex-shrink:0;">Recent Deliveries</div>
                    <div id="rptDeliveriesCount" style="font-size:28px;font-weight:700;color:var(--navy-dark);">0</div>
                </div>
            </div>

            <!-- Recent Invoices Table -->
            <div id="rptInvoicesTab" style="display:block;background:white;padding:1rem;border-radius:6px;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <h3 style="margin:0 0 0.75rem 0;color:var(--navy-dark);font-size:1rem;font-weight:600;">Recent Invoices</h3>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                        <thead>
                            <tr style="background:var(--cream);border-bottom:2px solid var(--border);">
                                <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Invoice ID</th>
                                <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Customer</th>
                                <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Amount</th>
                            </tr>
                        </thead>
                        <tbody id="rptInvoicesBody">
                            <tr><td colspan="3" style="padding:0.75rem;text-align:center;color:var(--text-muted);">No invoices found</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Recent Deliveries Table -->
            <div id="rptDeliveriesTab" style="display:none;background:white;padding:1rem;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <h3 style="margin:0 0 0.75rem 0;color:var(--navy-dark);font-size:1rem;font-weight:600;">Recent Deliveries</h3>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                        <thead>
                            <tr style="background:var(--cream);border-bottom:2px solid var(--border);">
                                <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Delivery ID</th>
                                <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Order Ref</th>
                                <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Status</th>
                            </tr>
                        </thead>
                        <tbody id="rptDeliveriesBody">
                            <tr><td colspan="3" style="padding:0.75rem;text-align:center;color:var(--text-muted);">No deliveries found</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Render report data
    renderReportsOverview();
    renderRecentInvoices();
    renderRecentDeliveries();
}

function renderReportsOverview() {
    // Orders: count only orders that have a paid invoice
    const totalOrders = (AppState.orders || []).filter(o =>
        (AppState.billings || []).some(b => b.orderRef === o.orderId && (b.status || '').toLowerCase() === 'paid')
    ).length;
    // Only count paid invoices as revenue
    const totalInvoices = (AppState.billings || []).filter(b => (b.status || '').toLowerCase() === 'paid')
        .reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
    const totalInventoryValue = ((AppState.inventoryManagementItems || []).concat(AppState.inventoryCatalogItems || [])).reduce((s, i) => s + ((i.unitPrice || 0) * (i.quantity || 0)), 0);
    const totalPayrolls = AppState.payrolls.length;

    const ordersEl = document.getElementById('rptTotalOrders');
    const revenueEl = document.getElementById('rptTotalRevenue');
    const invValEl = document.getElementById('rptInventoryValue');
    const payrollsEl = document.getElementById('rptTotalPayrolls');

    if (ordersEl) ordersEl.textContent = totalOrders;
    if (revenueEl) revenueEl.textContent = '₱' + totalInvoices.toFixed(2);
    if (invValEl) invValEl.textContent = '₱' + totalInventoryValue.toFixed(2);
    if (payrollsEl) payrollsEl.textContent = totalPayrolls;

    // Simple charts (textual summary)
    const charts = document.getElementById('rptCharts');
    if (charts) {
        charts.innerHTML = '';
        const topGarments = {};
        // Only include paid orders in charts
        const paidOrders = (AppState.orders || []).filter(o => (AppState.billings || []).some(b => b.orderRef === o.orderId && (b.status || '').toLowerCase() === 'paid'));
        paidOrders.forEach(o => { topGarments[o.garmentType] = (topGarments[o.garmentType] || 0) + (o.quantity || 0); });
        const topList = Object.entries(topGarments).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const ul = document.createElement('div');
        ul.innerHTML = '<h3 style="margin-top:0;margin-bottom:0.75rem;color:var(--navy-dark);">Top Garments (by qty)</h3>' + (topList.length ? topList.map(t => `${t[0]}: ${t[1]} pcs`).join('<br>') : 'No data');
        charts.appendChild(ul);
    }
}

function renderRecentInvoices() {
    const body = document.getElementById('rptInvoicesBody');
    const countEl = document.getElementById('rptInvoicesCount');
    if (!body) return;
    // Only show paid invoices in reports
    const invoices = (AppState.billings || []).filter(b => (b.status || '').toLowerCase() === 'paid').slice().reverse().slice(0, 10);
    if (countEl) countEl.textContent = invoices.length;
    if (invoices.length === 0) {
        body.innerHTML = '<tr style="border-bottom:1px solid var(--border);"><td colspan="3" style="padding:0.5rem;text-align:center;color:var(--text-muted);">No invoices</td></tr>';
        return;
    }
    body.innerHTML = invoices.map(i => `<tr style="border-bottom:1px solid var(--border);"><td style="padding:0.5rem;">${i.invoiceId}</td><td style="padding:0.5rem;">${i.customerName || '-'}</td><td style="padding:0.5rem;">₱${(i.amount || 0).toFixed(2)}</td></tr>`).join('');
}

function renderRecentDeliveries() {
    const body = document.getElementById('rptDeliveriesBody');
    const countEl = document.getElementById('rptDeliveriesCount');
    if (!body) return;
    // Only include deliveries whose related invoice is paid (reports should not show unpaid orders)
    const deliveries = (AppState.deliveries || []).filter(d =>
        (AppState.billings || []).some(b => b.orderRef === d.orderRef && (b.status || '').toLowerCase() === 'paid')
    ).slice().reverse().slice(0, 10);
    if (countEl) countEl.textContent = deliveries.length;
    if (deliveries.length === 0) {
        body.innerHTML = '<tr style="border-bottom:1px solid var(--border);"><td colspan="3" style="padding:0.5rem;text-align:center;color:var(--text-muted);">No deliveries</td></tr>';
        return;
    }
    body.innerHTML = deliveries.map(d => {
        const status = d.status || 'pending';
        const statusBadge = `<span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#E8F5E9;color:#2E7D32;border-radius:3px;">${status}</span>`;
        return `<tr style="border-bottom:1px solid var(--border);"><td style="padding:0.5rem;">${d.deliveryId}</td><td style="padding:0.5rem;">${d.orderRef || '-'}</td><td style="padding:0.5rem;">${statusBadge}</td></tr>`;
    }).join('');
}

// Switch report tab between invoices and deliveries
function switchReportTab(tabName) {
    document.querySelectorAll('.report-tab-card').forEach(card => {
        card.classList.remove('active');
        card.style.borderColor = '#F0EBE3';
        card.style.background = 'white';
        card.style.boxShadow = '0 2px 8px rgba(44,54,57,0.06)';
    });
    document.getElementById('rptInvoicesTab').style.display = 'none';
    document.getElementById('rptDeliveriesTab').style.display = 'none';
    const card = document.querySelector(`.report-tab-card[data-tab="${tabName}"]`);
    if (card) {
        card.classList.add('active');
        card.style.borderColor = 'var(--gold-primary)';
        card.style.background = 'linear-gradient(135deg, rgba(212, 175, 55, 0.05), rgba(212, 175, 55, 0.02))';
        card.style.boxShadow = '0 4px 24px rgba(212, 175, 55, 0.15)';
    }
    if (tabName === 'invoices') document.getElementById('rptInvoicesTab').style.display = 'block';
    if (tabName === 'deliveries') document.getElementById('rptDeliveriesTab').style.display = 'block';
}

function generateSalesReport() {
    const start = document.getElementById('rpt_start')?.value;
    const end = document.getElementById('rpt_end')?.value;
    // Use invoices (AppState.billings) as sales
    let list = AppState.billings || [];
    // Filter by createdDate if possible (createdDate is locale string) - best-effort parse
    if (start || end) {
        const s = start ? new Date(start) : null;
        const e = end ? new Date(end) : null;
        list = list.filter(inv => {
            const d = new Date(inv.createdDate);
            if (s && d < s) return false;
            if (e && d > e) return false;
            return true;
        });
    }

    // Only include paid invoices in sales report (revenue)
    list = list.filter(inv => (inv.status || '').toLowerCase() === 'paid');

    if (!list.length) { showMessage('Report', 'No paid invoices match the selected range', 'info'); return; }

    const rows = [['Invoice ID', 'Order Ref', 'Customer', 'Amount', 'Due Date', 'Status', 'CreatedDate']];
    list.forEach(i => rows.push([i.invoiceId, i.orderRef || '', i.customerName || '', (i.amount || 0).toFixed(2), i.dueDate || '', i.status || '', i.createdDate || '']));
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    downloadCSV('sales-report.csv', csv);
}

function exportInvoicesCSV() {
    // Export only paid invoices from reports
    const list = (AppState.billings || []).filter(b => (b.status || '').toLowerCase() === 'paid');
    if (!list.length) { showMessage('Export', 'No paid invoices to export', 'info'); return; }
    const rows = [['Invoice ID', 'Order Ref', 'Customer', 'Amount', 'Due Date', 'Status', 'CreatedDate']];
    list.forEach(i => rows.push([i.invoiceId, i.orderRef || '', i.customerName || '', (i.amount || 0).toFixed(2), i.dueDate || '', i.status || '', i.createdDate || '']));
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    downloadCSV('invoices-export.csv', csv);
}

function downloadCSV(filename, csvContent) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    if (navigator.msSaveBlob) { navigator.msSaveBlob(blob, filename); } else {
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// ==========================================
// MODAL UTILITIES
// ==========================================
// Add show/hide toggle to password inputs within a root element (or document)
function enablePasswordToggles(root = document) {
    try {
        const container = root instanceof Element ? root : document;
        const inputs = container.querySelectorAll('input[type="password"]:not([data-pw-toggle])');
        inputs.forEach(inp => {
            inp.setAttribute('data-pw-toggle', '1');
            const parent = inp.parentNode;
            // Create wrapper only if needed
            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';
            wrapper.style.display = 'block';
            // Keep the input's width
            wrapper.style.width = inp.style.width || '100%';
            parent.insertBefore(wrapper, inp);
            wrapper.appendChild(inp);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Toggle password visibility');
            btn.style.position = 'absolute';
            btn.style.right = '8px';
            btn.style.top = '50%';
            btn.style.transform = 'translateY(-50%)';
            btn.style.border = 'none';
            btn.style.background = 'transparent';
            btn.style.cursor = 'pointer';
            btn.style.padding = '4px';
            btn.style.fontSize = '1rem';
            // Inline SVGs for eye (show) and eye-slash (hide)
            const eyeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
            const eyeSlashSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.86 21.86 0 0 1 5.06-6.94"></path><path d="M1 1l22 22"></path><path d="M9.53 9.53a3 3 0 0 0 4.94 4.94"></path></svg>';
            btn.innerHTML = eyeSvg;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (inp.type === 'password') {
                    inp.type = 'text';
                    btn.innerHTML = eyeSlashSvg;
                    btn.title = 'Hide password';
                } else {
                    inp.type = 'password';
                    btn.innerHTML = eyeSvg;
                    btn.title = 'Show password';
                }
            });

            wrapper.appendChild(btn);
        });
    } catch (e) {
        console.error('enablePasswordToggles error', e);
    }
}

function createModal(title, content) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>${title}</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;
    // Ensure any password fields inside the modal get a toggle
    try { enablePasswordToggles(modal); } catch (e) { console.error(e); }
    return modal;
}

function createLargeModal(title, content) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>${title}</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;
    // Ensure any password fields inside the large modal get a toggle
    try { enablePasswordToggles(modal); } catch (e) { console.error(e); }
    return modal;
}

function closeModal() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    });
}

// Confirmation Modal for Critical Actions
function showConfirmAction(title, message, actionLabel, onConfirm, onCancel = null) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h2>${title}</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body" style="text-align: center; padding: 1.5rem;">
                <div style="margin-bottom: 1.5rem; font-size: 0.95rem; color: #333; line-height: 1.6;">
                    ${message}
                </div>
                <div style="display: flex; gap: 0.5rem; justify-content: center;">
                    <button class="btn btn-secondary" onclick="closeModal();" style="padding: 0.75rem 1.5rem; background: #95a5a6;">
                        Cancel
                    </button>
                    <button class="btn btn-primary" onclick="closeModal(); (${onConfirm.toString()})()" style="padding: 0.75rem 1.5rem; background: #e74c3c;">
                        ${actionLabel}
                    </button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').appendChild(modal);
}

function showPasswordModal(email) {
    return new Promise((resolve) => {
        const modalId = 'passwordModal-' + Date.now();
        const modal = createModal('Verify Your Password', `
            <div style="padding: 1.5rem;">
                <p style="margin-bottom: 1rem; color: #666; font-size: 0.95rem;">
                    For security, please enter your password to continue.
                </p>
                
                <form id="passwordModalForm-${modalId}" style="display: flex; flex-direction: column; gap: 1rem;">
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #333;">
                            Password
                        </label>
                        <input 
                            type="password" 
                            id="passwordModalInput-${modalId}" 
                            class="q-input" 
                            placeholder="Enter your password" 
                            style="width: 100%; padding: 0.75rem; border: 1px solid #DDD; border-radius: 4px; font-size: 1rem; box-sizing: border-box;"
                            autocomplete="current-password"
                        />
                        <p id="passwordModalError-${modalId}" style="color: #E74C3C; font-size: 0.85rem; margin-top: 0.5rem; display: none;"></p>
                    </div>

                    <div style="display: flex; gap: 0.75rem; margin-top: 1rem;">
                        <button 
                            type="button" 
                            id="passwordModalCancel-${modalId}"
                            class="btn-secondary" 
                            style="flex: 1; padding: 0.75rem; border: 1px solid #DDD; background: #F5F5F5; border-radius: 4px; cursor: pointer; font-weight: 600;"
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            class="btn-primary" 
                            style="flex: 1; padding: 0.75rem; background: #2980B9; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;"
                        >
                            Verify
                        </button>
                    </div>
                </form>
            </div>
        `);

        document.getElementById('modalContainer').appendChild(modal);
        modal.classList.add('active');

        const passwordInput = document.getElementById('passwordModalInput-' + modalId);
        const errorElement = document.getElementById('passwordModalError-' + modalId);
        const form = document.getElementById('passwordModalForm-' + modalId);
        const cancelBtn = document.getElementById('passwordModalCancel-' + modalId);

        // Focus on password input
        setTimeout(() => passwordInput.focus(), 100);

        // Handle form submission
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const password = passwordInput.value;

            if (!password) {
                errorElement.textContent = 'Password is required';
                errorElement.style.display = 'block';
                return;
            }

            closeModal();
            resolve(password);
        });

        // Handle cancel button
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeModal();
            resolve(null);
        });
    });
}

// ==========================================
// LOADING SCREEN FUNCTIONS
// ==========================================
function showLoading(text = 'Loading...') {
    const loadingScreen = document.getElementById('loadingScreen');
    const loadingText = document.getElementById('loadingText');
    if (loadingScreen && loadingText) {
        loadingText.textContent = text;
        loadingScreen.classList.add('active');
    }
}

function hideLoading() {
    const loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) {
        loadingScreen.classList.remove('active');
    }
}

function formatStatus(status) {
    // Normalize status for display: accepts space, hyphen or underscore separated values
    if (!status) return '';
    const normalized = String(status).replace(/[-\s]+/g, '_');
    return normalized.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function normalizeStatusForClass(status) {
    if (!status) return '';
    return String(status).replace(/[-\s]+/g, '_').toLowerCase();
}

function showMessage(title, message, type = 'info') {
    const modal = createModal(title, `
        <div style="text-align:center;">
            <div style="margin-bottom:1.25rem;font-size:2.5rem;">
                ${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}
            </div>
            <p style="font-size:0.95rem;color:#333;line-height:1.7;margin-bottom:0;">${message}</p>
            <div style="margin-top:1.5rem;display:flex;gap:0.75rem;justify-content:center;">
                <button class="btn-primary" onclick="closeModal()" style="padding:0.7rem 1.75rem;background:linear-gradient(135deg, var(--gold-primary), var(--gold-dark));color:white;border:none;border-radius:6px;font-size:0.9rem;font-weight:600;cursor:pointer;transition:all 0.2s ease;font-family:'Cormorant Garamond',serif;letter-spacing:0.05em;">OK</button>
            </div>
        </div>
    `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

// =====================
// Order & Quotation Modal (8-step)
// =====================
AppState.newQuotation = { step: 1, data: {}, files: [], deliveryType: 'for_delivery' };

function openOrderQuotationModal() {
    AppState.newQuotation = { step: 1, data: {}, files: [], selectedOrderType: null, sizes: [], colors: [], accessories: [], deliveryType: 'for_delivery' };
    const modal = createLargeModalWithStepper('New Order & Quotation', getOrderQuotationStepContent(1));
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
    attachQuotationHandlers(modal);
}

function createLargeModalWithStepper(title, content) {
    const stage = document.createElement('div');
    stage.className = 'modal quotation-modal';
    stage.innerHTML = `
        <div class="modal-content modal-quotation">
            <div class="modal-quotation-header">
                <div class="quotation-branding">
                    <h1 class="quotation-title">${title}</h1>
                    <p class="quotation-subtitle">Garment Manufacturing Integrated Management System</p>
                </div>
                <div class="quotation-order-no">ORD-2026-0001</div>
                <button type="button" class="modal-close" onclick="closeModal()">&times;</button>
            </div>
            
            <div class="quotation-stepper">
                <div class="stepper-container">
                    <div class="step-item active" data-step="1">
                        <div class="step-circle">1</div>
                        <div class="step-label">Client Info</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item" data-step="2">
                        <div class="step-circle">2</div>
                        <div class="step-label">Order Details</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item" data-step="3">
                        <div class="step-circle">3</div>
                        <div class="step-label">Design Files</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item" data-step="4">
                        <div class="step-circle">4</div>
                        <div class="step-label">Specifications</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item" data-step="5">
                        <div class="step-circle">5</div>
                        <div class="step-label">Accessories</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item" data-step="6">
                        <div class="step-circle">6</div>
                        <div class="step-label">Approval Sheet</div>
                    </div>
                    <div class="step-connector"></div>
                    <div class="step-item" data-step="7">
                        <div class="step-circle">7</div>
                        <div class="step-label">Review</div>
                    </div>
                </div>
            </div>
            
            <div class="modal-body quotation-body">
                ${content}
            </div>
        </div>
    `;
    return stage;
}

function getOrderQuotationStepContent(step) {
    switch (step) {
        case 1: return getQuotationStep1();
        case 2: return getQuotationStep2();
        case 3: return getQuotationStep3();
        case 4: return getQuotationStep4();
        case 5: return getQuotationStep5();
        case 6: return getQuotationStep6();
        case 7: return getQuotationStep7();
        case 8: return getQuotationStep8();
        default: return `<div class="form-card">Invalid step</div>`;
    }
}

function getQuotationStep1() {
    const deliveryType = AppState.newQuotation?.deliveryType || 'for_delivery';
    return `
        <div class="quotation-form-section">
            <div class="q-section-header">
                <h2>Client Information</h2>
                <p>Enter customer details for order processing</p>
            </div>
            <div class="q-form-group" style="margin-bottom: 2rem;">
                <label style="display: block; margin-bottom: 1rem;">Delivery Type <span class="q-required">*</span></label>
                <div class="q-order-type-selector">
                    <div class="q-order-type-card ${deliveryType === 'for_delivery' ? 'q-order-type-card-selected' : ''}" onclick="selectQuotationDeliveryType('for_delivery')">
                        <div style="font-weight:700;font-size:1.2rem;margin-bottom:0.5rem;color:var(--gold-primary);">For Delivery</div>
                        <div style="font-size:0.95rem;color:var(--text-muted);">Shipped to customer<br><small style="font-size:0.85rem;">Requires shipping address</small></div>
                    </div>
                    <div class="q-order-type-card ${deliveryType === 'for_pickup' ? 'q-order-type-card-selected' : ''}" onclick="selectQuotationDeliveryType('for_pickup')">
                        <div style="font-weight:700;font-size:1.2rem;margin-bottom:0.5rem;color:var(--gold-primary);">For Pick Up</div>
                        <div style="font-size:0.95rem;color:var(--text-muted);">Customer pickup<br><small style="font-size:0.85rem;">No shipping required</small></div>
                    </div>
                </div>
            </div>
            <div class="q-form-grid-2col">
                <div class="q-form-group">
                    <label>Customer Name <span class="q-required">*</span></label>
                    <input id="q_customerName" type="text" class="q-input" placeholder="Full name" required>
                </div>
                <div class="q-form-group">
                    <label>Contact Number <span class="q-required">*</span></label>
                    <input id="q_contactNumber" type="tel" class="q-input" placeholder="Phone number" required>
                </div>
                <div class="q-form-group">
                    <label>Email Address <span class="q-required">*</span></label>
                    <input id="q_email" type="email" class="q-input" placeholder="Email address" required>
                </div>
                <div class="q-form-group" ${deliveryType === 'for_pickup' ? 'style="display:none;"' : ''} id="q_addressGroup">
                    <label>Shipping Address <span class="q-required">*</span></label>
                    <input id="q_address" type="text" class="q-input" placeholder="Full address" ${deliveryType === 'for_delivery' ? 'required' : ''}>
                </div>
            </div>
            <div class="q-form-actions">
                <button class="q-btn q-btn-secondary" onclick="navigateTo('orders')">← Cancel</button>
                <button class="q-btn q-btn-primary" onclick="nextQuotationStep(1)">Continue →</button>
            </div>
        </div>
    `;
}

function getQuotationStep2() {
    return `
        <div class="quotation-form-section">
            <div class="q-section-header">
                <h2>Order Type & Details</h2>
                <p>Select order type and garment information</p>
            </div>
            <div class="q-form-group" style="margin-bottom: 2rem;">
                <label style="display: block; margin-bottom: 1rem;">Order Type <span class="q-required">*</span></label>
                <div class="q-order-type-selector">
                    <div class="q-order-type-card" onclick="selectQuotationOrderType('FOB')">
                        <div style="font-weight:700;font-size:1.2rem;margin-bottom:0.5rem;color:var(--gold-primary);">FOB</div>
                        <div style="font-size:0.95rem;color:var(--text-muted);">Full Package<br><small style="font-size:0.85rem;">Complete garment with all materials</small></div>
                    </div>
                    <div class="q-order-type-card" onclick="selectQuotationOrderType('CMT')">
                        <div style="font-weight:700;font-size:1.2rem;margin-bottom:0.5rem;color:var(--gold-primary);">CMT</div>
                        <div style="font-size:0.95rem;color:var(--text-muted);">Cut Make Trim<br><small style="font-size:0.85rem;">Labor only, material provided</small></div>
                    </div>
                </div>
            </div>
            <div class="q-form-grid-2col">
                <div class="q-form-group">
                    <label>Garment Type <span class="q-required">*</span></label>
                    <select id="q_garmentType" class="q-input">
                        <option value="">Select garment</option>
                        <option value="T-Shirt">T-Shirt</option>
                        <option value="Polo Shirt">Polo Shirt</option>
                        <option value="Dress Shirt">Dress Shirt</option>
                        <option value="Dress">Dress</option>
                        <option value="Pants">Pants</option>
                        <option value="Skirt">Skirt</option>
                        <option value="Shorts">Shorts</option>
                        <option value="Jacket">Jacket</option>
                        <option value="Blazer">Blazer</option>
                        <option value="Cardigan">Cardigan</option>
                        <option value="Sweater">Sweater</option>
                        <option value="Custom">Custom</option>
                    </select>
                </div>
            </div>
            <div class="q-form-actions">
                <button class="q-btn q-btn-secondary" onclick="prevQuotationStep(2)">← Back</button>
                <button class="q-btn q-btn-primary" onclick="nextQuotationStep(2)">Continue →</button>
            </div>
        </div>
    `;
}

function getQuotationStep3() {
    return `
        <div class="quotation-form-section">
            <div class="q-section-header">
                <h2>Design & Reference Files</h2>
                <p>Upload technical documents and design references (required)</p>
            </div>
            <div class="file-upload-zone" id="q_fileUploadZone" style="border:2px dashed var(--gold-primary);border-radius:10px;padding:3rem;text-align:center;cursor:pointer;transition:all 0.3s;background:rgba(212, 175, 55, 0.05);">
                <div class="upload-icon" style="font-size:3rem;margin-bottom:1rem;">📎</div>
                <div style="font-weight:600;margin-bottom:0.5rem;color:var(--navy-dark);font-size:1.1rem;">Drop files here or click to browse</div>
                <div style="font-size:0.85rem;color:var(--text-muted);">Supported: PDF, JPG, PNG, AI, PSD, ZIP</div>
                <input type="file" id="q_fileInput" multiple style="display:none;">
            </div>
            <div id="q_fileList" class="file-list" style="margin-top:1.5rem;"></div>
            <div class="q-form-actions">
                <button class="q-btn q-btn-secondary" onclick="prevQuotationStep(3)">← Back</button>
                <button class="q-btn q-btn-primary" onclick="nextQuotationStep(3)">Continue →</button>
            </div>
        </div>
    `;
}

// ==========================================
// SIZE SELECTION HELPER
// ==========================================
// Calculate yards needed based on garment type
// Calculate yards needed based on garment type
function getYardsForGarment(garmentType) {
    const yardsMap = {
        'T-Shirt': 1.25,
        'Polo Shirt': 1.5,
        'Dress Shirt': 1.75,
        'Dress': 2.5,
        'Skirt': 1.5,
        'Pants': 2,
        'Shorts': 1.25,
        'Jacket': 3,
        'Blazer': 2.75,
        'Sweater': 1.5,
        'Cardigan': 2,
        'Uniform': 2.5,
        'Custom': 2
    };
    return yardsMap[garmentType] || 2;
}

function getSizeOptionsForGarment(garmentType) {
    switch (garmentType) {
        case 'Dress':
            // Bust measurements for dresses (sequential from 32)
            return ['32 Bust', '33 Bust', '34 Bust', '35 Bust', '36 Bust', '37 Bust', '38 Bust', '39 Bust', '40 Bust', '41 Bust', '42 Bust', '43 Bust', '44 Bust', '45 Bust', '46 Bust', '47 Bust', '48 Bust', '49 Bust', '50 Bust'];
        case 'Skirt':
            // Waist measurements for skirts (sequential from 22)
            return ['22 Waist', '23 Waist', '24 Waist', '25 Waist', '26 Waist', '27 Waist', '28 Waist', '29 Waist', '30 Waist', '31 Waist', '32 Waist', '33 Waist', '34 Waist', '35 Waist', '36 Waist', '37 Waist', '38 Waist', '39 Waist', '40 Waist', '41 Waist', '42 Waist', '43 Waist', '44 Waist', '45 Waist', '46 Waist', '47 Waist', '48 Waist', '49 Waist', '50 Waist'];
        case 'Pants':
            // Waist measurements for pants (sequential from 22)
            return ['22 Waist', '23 Waist', '24 Waist', '25 Waist', '26 Waist', '27 Waist', '28 Waist', '29 Waist', '30 Waist', '31 Waist', '32 Waist', '33 Waist', '34 Waist', '35 Waist', '36 Waist', '37 Waist', '38 Waist', '39 Waist', '40 Waist', '41 Waist', '42 Waist', '43 Waist', '44 Waist', '45 Waist', '46 Waist', '47 Waist', '48 Waist', '49 Waist', '50 Waist'];
        case 'Shorts':
            // Waist measurements for shorts (sequential from 22)
            return ['22 Waist', '23 Waist', '24 Waist', '25 Waist', '26 Waist', '27 Waist', '28 Waist', '29 Waist', '30 Waist', '31 Waist', '32 Waist', '33 Waist', '34 Waist', '35 Waist', '36 Waist', '37 Waist', '38 Waist', '39 Waist', '40 Waist', '41 Waist', '42 Waist'];
        case 'T-Shirt':
        case 'Polo Shirt':
        case 'Dress Shirt':
            // Standard letter sizes for shirts
            return ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
        case 'Jacket':
        case 'Blazer':
        case 'Sweater':
        case 'Cardigan':
            // Standard letter sizes for outerwear
            return ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
        default:
            // General sizes for custom/other types
            return ['FREE-SIZE', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];
    }
}

function generateSizeSelectOptions(garmentType) {
    const sizes = getSizeOptionsForGarment(garmentType);
    return sizes.map(size => `<option value="${size}">${size}</option>`).join('');
}

function getQuotationStep4() {
    const garmentType = AppState.newQuotation?.garmentType || '';
    const sizeOptions = generateSizeSelectOptions(garmentType);
    const orderType = AppState.newQuotation.selectedOrderType;
    const isCMT = orderType === 'CMT';

    return `
        <div class="quotation-form-section">
            <div class="q-section-header">
                <h2>Order Specifications</h2>
                <p>${isCMT ? 'Add size breakdown (fabrics will be provided by customer)' : 'Add size breakdown and color information'}</p>
            </div>
            <div style="margin-bottom:2rem;">
                <h4 style="margin-bottom:1rem;color:var(--navy-dark);font-weight:600;font-size:1.1rem;">Size Breakdown ${garmentType ? `(${garmentType})` : ''}</h4>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:var(--navy-dark);color:white;"><th style="padding:1rem;text-align:left;">Size</th><th style="padding:1rem;text-align:left;">Quantity</th><th style="padding:1rem;text-align:left;">Action</th></tr></thead>
                        <tbody id="q_sizeBreakdownBody"><tr><td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><select class="q-input" style="width:100%;">${sizeOptions || '<option value="">Select size</option>'}</select></td><td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><input type="number" class="q-input q-size-qty" style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;" min="1" value="1"></td><td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><button type="button" style="background:none;border:none;color:var(--navy-dark);cursor:pointer;font-size:1.5rem;font-weight:bold;" onclick="removeQuotationSizeRow(this)">×</button></td></tr></tbody>
                    </table>
                </div>
                <button type="button" style="margin-top:1rem;background:var(--navy-dark);color:white;border:none;padding:0.75rem 1.5rem;border-radius:6px;cursor:pointer;font-weight:600;transition:all 0.3s;" onclick="addQuotationSizeRow()">+ Add Size</button>
            </div>
            ${!isCMT ? `<div style="margin-bottom:2rem;">
                <h4 style="margin-bottom:1rem;color:var(--navy-dark);font-weight:600;font-size:1.1rem;">Color Breakdown</h4>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:var(--navy-dark);color:white;"><th style="padding:1rem;text-align:left;">Fabric Type</th><th style="padding:1rem;text-align:left;">Color</th><th style="padding:1rem;text-align:left;">Yards</th><th style="padding:1rem;text-align:left;">Preview</th><th style="padding:1rem;text-align:left;">Action</th></tr></thead>
                        <tbody id="q_colorBreakdownBody"></tbody>
                    </table>
                </div>
                <button type="button" style="margin-top:1rem;background:var(--navy-dark);color:white;border:none;padding:0.75rem 1.5rem;border-radius:6px;cursor:pointer;font-weight:600;transition:all 0.3s;" onclick="addQuotationColorRow()">+ Add Color</button>
            </div>` : `<div style="padding:1rem;background:#E8F4EE;border-left:4px solid #27AE60;border-radius:4px;margin-bottom:2rem;">
                <p style="margin:0;color:#1E7E34;font-weight:600;">✓ CMT Order - Fabrics & Colors will be provided by customer</p>
            </div>`}
        <div class="q-form-actions">
            <button class="q-btn q-btn-secondary" onclick="prevQuotationStep(4)">← Back</button>
            <button class="q-btn q-btn-primary" onclick="nextQuotationStep(4)">Continue →</button>
        </div>
        </div>
        `;
}

function getQuotationStep5() {
    return `
        <div class="quotation-form-section">
            <div class="q-section-header">
                <h2>Accessories & Add-ons</h2>
                <p>Add buttons, zippers, embroidery, labels, and other accessories</p>
            </div>
            <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:var(--navy-dark);color:white;"><th style="padding:1rem;text-align:left;">Type</th><th style="padding:1rem;text-align:left;">Unit Price (₱)</th><th style="padding:1rem;text-align:left;">Qty</th><th style="padding:1rem;text-align:left;">Color</th><th style="padding:1rem;text-align:left;">Total Cost (₱)</th><th style="padding:1rem;text-align:left;">Action</th></tr></thead>
                    <tbody id="q_accessoriesBody"></tbody>
                    </table>
            </div>
            <button type="button" style="margin-top:1rem;background:var(--navy-dark);color:white;border:none;padding:0.75rem 1.5rem;border-radius:6px;cursor:pointer;font-weight:600;transition:all 0.3s;" onclick="addQuotationAccessoryRow()">+ Add Accessory</button>
            <div class="q-form-actions">
                <button class="q-btn q-btn-secondary" onclick="prevQuotationStep(5)">← Back</button>
                <button class="q-btn q-btn-primary" onclick="nextQuotationStep(5)">Continue →</button>
            </div>
        </div>
        `;
}

function getQuotationStep6() {
    return `
        <div class="quotation-form-section">
            <div style="background:white;padding:2.5rem;border-radius:10px;border:2px solid var(--navy-dark);line-height:1.8;font-family:Cormorant Garamond, serif;">
                
                <!-- Header -->
                <div style="text-align:center;margin-bottom:2rem;border-bottom:3px solid var(--navy-dark);padding-bottom:1.5rem;">
                    <h1 style="margin:0;color:var(--navy-dark);font-size:1.8rem;font-weight:700;">GOLDENTHREADS GARMENTS MANUFACTURING</h1>
                    <h2 style="margin:0.5rem 0;color:var(--navy-dark);font-size:1.5rem;font-weight:600;">Quotation & Approval Sheet</h2>
                </div>

                <!-- Customer & Order Details -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-bottom:2rem;">
                    <div>
                        <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">CUSTOMER NAME:</strong></p>
                        <p style="margin:0;color:var(--navy-dark);font-size:1rem;" id="q_appr_custName">-</p>
                    </div>
                    <div>
                        <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">ORDER TYPE:</strong></p>
                        <p style="margin:0;color:var(--navy-dark);font-size:1rem;" id="q_appr_orderType">-</p>
                    </div>
                    <div>
                        <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">CONTACT NUMBER:</strong></p>
                        <p style="margin:0;color:var(--navy-dark);font-size:1rem;" id="q_appr_contact">-</p>
                    </div>
                    <div>
                        <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">EMAIL ADDRESS:</strong></p>
                        <p style="margin:0;color:var(--navy-dark);font-size:1rem;" id="q_appr_email">-</p>
                    </div>
                    <div style="grid-column:1/3;">
                        <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">SHIPPING ADDRESS:</strong></p>
                        <p style="margin:0;color:var(--navy-dark);font-size:1rem;" id="q_appr_address">-</p>
                    </div>
                </div>

                <!-- Order Specifications -->
                <div style="margin-bottom:2rem;border-top:2px solid var(--navy-dark);border-bottom:2px solid var(--navy-dark);padding:1.5rem 0;">
                    <h3 style="margin:0 0 1rem 0;color:var(--navy-dark);font-size:1.2rem;">ORDER SPECIFICATIONS</h3>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;">
                        <div>
                            <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">GARMENT TYPE:</strong></p>
                            <p style="margin:0;color:var(--navy-dark);font-size:1rem;" id="q_appr_garment">-</p>
                        </div>
                        <div>
                            <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">TOTAL QUANTITY:</strong></p>
                            <p style="margin:0;color:var(--navy-dark);font-size:1rem;" id="q_appr_qty">0 pcs</p>
                        </div>
                        <div style="grid-column:1/3;">
                            <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">SIZE BREAKDOWN:</strong></p>
                            <p style="margin:0;color:var(--navy-dark);font-size:0.95rem;" id="q_appr_sizes">-</p>
                        </div>
                        <div style="grid-column:1/3;">
                            <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">FABRICS & COLORS:</strong></p>
                            <div style="margin:0;color:var(--navy-dark);font-size:0.95rem;" id="q_appr_colors">-</div>
                        </div>
                        <div style="grid-column:1/3;">
                            <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">ACCESSORIES & ADD-ONS:</strong></p>
                            <p style="margin:0;color:var(--navy-dark);font-size:0.95rem;" id="q_appr_accessories">-</p>
                        </div>
                        <div style="grid-column:1/3;">
                            <p style="margin:0 0 0.5rem 0;"><strong style="color:var(--navy-dark);font-size:0.95rem;">DESIGN FILES:</strong></p>
                            <p style="margin:0;color:var(--navy-dark);font-size:0.95rem;" id="q_appr_designFiles">-</p>
                        </div>
                    </div>
                </div>

                <!-- Declaration -->
                <div style="margin:2rem 0;padding:1.5rem;background:var(--cream);border-left:4px solid var(--navy-dark);border-radius:6px;">
                    <p style="margin:0;color:var(--navy-dark);line-height:1.8;text-align:justify;">
                        <strong style="font-size:1rem;">I hereby</strong> certify and approve the above order specifications and quotation details. 
                        I acknowledge that this order will be processed and manufactured according to the specifications listed above. 
                        All terms and conditions have been reviewed and understood.
                    </p>
                </div>

                <!-- Signature Section -->
                <div style="margin-top:2.5rem;padding-top:2rem;border-top:2px solid var(--navy-dark);text-align:center;">
                    <!-- Signature Line (Centered) -->
                    <div style="margin:0 auto;width:300px;">
                        <p style="margin:0;height:45px;border-bottom:2px solid var(--navy-dark);"></p>
                    </div>

                    <!-- Customer Name (Centered below signature line) -->
                    <p style="margin:1rem 0 0 0;color:var(--navy-dark);font-size:0.95rem;font-weight:600;" id="q_appr_custName_sign">-</p>
                    
                    <!-- Signature Label -->
                    <p style="margin:0.5rem 0 0 0;color:var(--navy-dark);font-size:0.9rem;text-decoration:underline;"><strong>Signature</strong></p>
                </div>

            </div>

            <div class="q-form-actions" style="margin-top:2rem;justify-content:space-between;">
                <button class="q-btn q-btn-secondary" onclick="prevQuotationStep(6)">← Back</button>
                <button class="q-btn q-btn-primary" type="button" onclick="printApprovalSheet()" style="background:var(--navy-dark);color:white;">🖨️ Print Approval Sheet</button>
                <button class="q-btn q-btn-primary" onclick="nextQuotationStep(6)">Continue →</button>
            </div>
        </div>
        `;
}

function getQuotationStep7() {
    const orderType = AppState.newQuotation.selectedOrderType;
    const isCMT = orderType === 'CMT';

    return `
        <div class="quotation-form-section">
            <div class="q-section-header">
                <h2>Costing & Quotation</h2>
                <p>${isCMT ? 'Labor-only quotation (customer provides materials)' : 'Automatic cost breakdown and quotation'}</p>
            </div>
            ${isCMT ? `<div style="padding:1rem;background:#FFF9E6;border-left:4px solid #F39C12;border-radius:4px;margin-bottom:2rem;">
                <p style="margin:0;color:#856404;font-weight:600;"><strong>CMT Order:</strong> Pricing includes labor, overhead, and profit. Materials will be provided by customer.</p>
            </div>` : ''
        }
            <div style="background:var(--cream);padding:2rem;border-radius:10px;margin-bottom:2rem;">
                ${isCMT ? '' : `<div style="display:flex;justify-content:space-between;padding:1rem 0;border-bottom:2px solid var(--border-light);"><span style="font-weight:600;">Fabric Cost:</span><span class="mono" id="q_fabricCost">₱0.00</span></div>`}
                <div style="display:flex;justify-content:space-between;padding:1rem 0;border-bottom:2px solid var(--border-light);"><span style="font-weight:600;">Labor Cost:</span><span class="mono" id="q_laborCost">₱0.00</span></div>
                <div style="display:flex;justify-content:space-between;padding:1rem 0;border-bottom:2px solid var(--border-light);"><span style="font-weight:600;">Accessories:</span><span class="mono" id="q_accCost">₱0.00</span></div>
                <div style="display:flex;justify-content:space-between;padding:1rem 0;border-bottom:2px solid var(--border-light);"><span style="font-weight:600;">Overhead (15%):</span><span class="mono" id="q_overhead">₱0.00</span></div>
                <div style="display:flex;justify-content:space-between;padding:1rem 0;border-bottom:2px solid var(--border-light);"><span style="font-weight:600;">Subtotal:</span><span class="mono" id="q_subtotal" style="font-weight:700;color:var(--navy-dark);">₱0.00</span></div>
                <div style="display:flex;justify-content:space-between;padding:1rem 0;border-bottom:2px solid var(--border-light);"><span style="font-weight:600;">Profit Margin:</span><span class="mono" id="q_profitAmount">₱0.00</span></div>
                <div style="display:flex;justify-content:space-between;padding:1.25rem;background:linear-gradient(135deg, var(--navy-dark) 0%, var(--navy-medium) 100%);color:white;border-radius:8px;margin-top:1rem;font-weight:700;"><span>Total Quotation:</span><span class="mono" id="q_totalQuotation" style="font-size:1.3rem;">₱0.00</span></div>
            </div>
            <div class="q-form-grid-2col">
                <div class="q-form-group">
                    <label>Profit Margin</label>
                    <select id="q_profitMargin" class="q-input" onchange="calculateQuotationCosting()"><option value="0.25">25% (Standard)</option><option value="0.30">30%</option><option value="0.35">35%</option><option value="0.40">40% (Complex)</option></select>
                </div>
                <div class="q-form-group">
                    <label>Lead Time (days)</label>
                    <input id="q_leadTime" type="number" min="1" value="14" class="q-input" onchange="calculateQuotationCosting()">
                </div>
            </div>
            <div class="q-form-actions">
                <button class="q-btn q-btn-secondary" onclick="prevQuotationStep(7)">← Back</button>
                <button class="q-btn q-btn-primary" onclick="nextQuotationStep(7)">Continue →</button>
            </div>
            </div>
        `;
}

function getQuotationStep8() {
    return `
        <div class="quotation-form-section">
            <div class="q-section-header">
                <h2>Review & Submit</h2>
                <p>Verify all information before submission</p>
            </div>
            <div id="q_reviewSummary" style="background:var(--cream);padding:2rem;border-radius:10px;margin-bottom:2rem;line-height:1.9;border-left:4px solid var(--navy-dark);">
                <h3 style="color:var(--navy-dark);margin-top:0;margin-bottom:1rem;font-size:1.1rem;border-bottom:2px solid var(--navy-dark);padding-bottom:0.5rem;">Order Summary</h3>
                <p><strong style="color:var(--navy-dark);">Customer:</strong> <span id="review_customer">-</span></p>
                <p><strong style="color:var(--navy-dark);">Delivery Type:</strong> <span id="review_deliveryType">-</span></p>
                <p><strong style="color:var(--navy-dark);">Order Type:</strong> <span id="review_orderType">-</span></p>
                <p><strong style="color:var(--navy-dark);">Garment Type:</strong> <span id="review_garment">-</span></p>
                <p><strong style="color:var(--navy-dark);">Total Quantity:</strong> <span id="review_qty">0</span> pcs</p>
                
                <h3 style="color:var(--navy-dark);margin-top:1.5rem;margin-bottom:1rem;font-size:1.1rem;border-bottom:2px solid var(--navy-dark);padding-bottom:0.5rem;">Pricing Breakdown</h3>
                <p><strong style="color:var(--navy-dark);">Fabric Cost:</strong> <span id="review_fabricCost" class="mono" style="float:right;">₱0.00</span></p>
                <p><strong style="color:var(--navy-dark);">Labor Cost:</strong> <span id="review_laborCost" class="mono" style="float:right;">₱0.00</span></p>
                <p><strong style="color:var(--navy-dark);">Accessories Cost:</strong> <span id="review_accCost" class="mono" style="float:right;">₱0.00</span></p>
                <p><strong style="color:var(--navy-dark);">Overhead (15%):</strong> <span id="review_overhead" class="mono" style="float:right;">₱0.00</span></p>
                <p><strong style="color:var(--navy-dark);">Subtotal:</strong> <span id="review_subtotal" class="mono" style="float:right;">₱0.00</span></p>
                <p><strong style="color:var(--navy-dark);">Profit Margin:</strong> <span id="review_profitAmount" class="mono" style="float:right;">₱0.00</span></p>
                <p style="margin-top:1.5rem;padding-top:1.5rem;border-top:2px solid var(--navy-dark);"><strong style="color:var(--navy-dark);">Total Quotation:</strong> <span id="review_totalAmount" class="mono" style="color:var(--navy-dark);font-weight:700;font-size:1.2rem;float:right;">₱0.00</span></p>
            </div>
            <div class="q-form-actions">
                <button class="q-btn q-btn-secondary" onclick="prevQuotationStep(8)">← Back</button>
                <button class="q-btn q-btn-primary" onclick="submitQuotationFromModal()">Submit Quotation</button>
            </div>
        </div>
        `;
}

function nextQuotationStep(current) {
    const orderType = AppState.newQuotation.selectedOrderType;
    saveQuotationStepData(current);

    // Save table data before moving to next step
    if (current === 4) {
        AppState.newQuotation.sizes = [];
        document.querySelectorAll('#q_sizeBreakdownBody tr').forEach(row => {
            const sizeSelect = row.querySelector('select');
            const qtyInput = row.querySelector('input[type="number"]');
            if (sizeSelect && sizeSelect.value) {
                AppState.newQuotation.sizes.push({
                    size: sizeSelect.value,
                    quantity: parseInt(qtyInput?.value) || 1
                });
            }
        });
    }
    if (current === 4) {
        AppState.newQuotation.colors = [];
        // For CMT orders, skip color selection (materials provided by customer)
        if (orderType !== 'CMT') {
            const garmentType = AppState.newQuotation?.data?.garmentType || '';
            const yardsPerGarment = getYardsForGarment(garmentType);

            // Calculate total quantity from sizes
            let totalQty = 0;
            (AppState.newQuotation.sizes || []).forEach(s => {
                totalQty += s.quantity || 0;
            });
            const totalYards = yardsPerGarment * totalQty;

            const availableColors = getAvailableColors();
            document.querySelectorAll('#q_colorBreakdownBody tr').forEach(row => {
                const colorSelect = row.cells[1]?.querySelector('select');
                const fabricSelect = row.cells[0]?.querySelector('select');
                if (colorSelect && colorSelect.value) {
                    const selectedHex = colorSelect.value;
                    const selectedFabric = fabricSelect?.value || '';
                    const colorObj = availableColors.find(c => c.hex === selectedHex);
                    if (colorObj) {
                        // Find the fabric item from inventory to get price
                        const fabricItem = (AppState.inventoryManagementItems || []).find(i =>
                            i.category === 'Fabric' &&
                            (selectedFabric ? (i.name || '').includes(selectedFabric) : true) &&
                            (i.color === selectedHex || i.name.includes(colorObj.name))
                        );

                        AppState.newQuotation.colors.push({
                            hex: colorObj.hex,
                            name: colorObj.name,
                            fabricTypes: colorObj.fabricTypes || [],
                            yards: parseFloat(totalYards.toFixed(2)),
                            fabricSku: fabricItem?.sku || '',
                            fabricPrice: fabricItem?.unitPrice || 0
                        });
                    }
                }
            });
        }
    }
    if (current === 5) {
        AppState.newQuotation.accessories = [];
        const accessoriesCats = ['Accessory', 'Button', 'Zipper', 'Fastener', 'Yarn'];
        const availableAccessories = (AppState.inventoryManagementItems || []).filter(i => accessoriesCats.includes(i.category));
        document.querySelectorAll('#q_accessoriesBody tr').forEach(row => {
            const typeSelect = row.cells[0]?.querySelector('select');
            const priceInput = row.cells[1]?.querySelector('input[type="number"]');
            const qtyInput = row.cells[2]?.querySelector('input[type="number"]');
            if (typeSelect && typeSelect.value && priceInput && priceInput.value && qtyInput && qtyInput.value) {
                const selectedAcc = availableAccessories.find(a => a.sku === typeSelect.value);
                if (selectedAcc) {
                    AppState.newQuotation.accessories.push({
                        sku: selectedAcc.sku,
                        name: selectedAcc.name,
                        price: parseFloat(priceInput.value) || 0,
                        quantity: parseInt(qtyInput.value) || 0,
                        color: selectedAcc.color || null
                    });
                }
            }
        });
    }

    // Skip step 6 (approval sheet) for CMT orders
    if (current === 5 && orderType === 'CMT') {
        AppState.newQuotation.step = 7;  // Skip approval, go to costing
    } else {
        AppState.newQuotation.step = Math.min(8, current + 1);  // Allow reaching step 8
    }

    // Handle both page and modal contexts
    const modal = document.querySelector('#modalContainer .modal.active');
    const pageBody = document.querySelector('.quotation-page-body');

    const bodyElement = pageBody || (modal && modal.querySelector('.modal-body'));
    if (!bodyElement) return;

    bodyElement.innerHTML = getOrderQuotationStepContent(AppState.newQuotation.step);
    updateQuotationStepper(AppState.newQuotation.step);
    attachQuotationHandlers();

    // Populate approval sheet data when reaching step 6
    if (AppState.newQuotation.step === 6) {
        setTimeout(() => populateQuotationApprovalPreview(), 100);
    }

    // Auto-calculate on step 7
    if (AppState.newQuotation.step === 7) {
        setTimeout(() => calculateQuotationCosting(), 100);
    }

    // Populate review on step 8
    if (AppState.newQuotation.step === 8) {
        setTimeout(() => populateQuotationReview(), 100);
    }
}

function prevQuotationStep(current) {
    const orderType = AppState.newQuotation.selectedOrderType;

    // Save current step data before going back
    saveQuotationStepData(current);

    // Save table data from current step before moving back
    if (current === 4) {
        AppState.newQuotation.sizes = [];
        document.querySelectorAll('#q_sizeBreakdownBody tr').forEach(row => {
            const sizeSelect = row.querySelector('select');
            const qtyInput = row.querySelector('input[type="number"]');
            if (sizeSelect && sizeSelect.value) {
                AppState.newQuotation.sizes.push({
                    size: sizeSelect.value,
                    quantity: parseInt(qtyInput?.value) || 1
                });
            }
        });
    }
    if (current === 5) {
        AppState.newQuotation.colors = [];
        // For CMT orders, skip color selection (materials provided by customer)
        if (orderType !== 'CMT') {
            const garmentType = AppState.newQuotation?.data?.garmentType || '';
            const yardsPerGarment = getYardsForGarment(garmentType);

            // Calculate total quantity from sizes
            let totalQty = 0;
            (AppState.newQuotation.sizes || []).forEach(s => {
                totalQty += s.quantity || 0;
            });
            const totalYards = yardsPerGarment * totalQty;

            const availableColors = getAvailableColors();
            document.querySelectorAll('#q_colorBreakdownBody tr').forEach(row => {
                const colorSelect = row.cells[1]?.querySelector('select');
                const fabricSelect = row.cells[0]?.querySelector('select');
                if (colorSelect && colorSelect.value) {
                    const selectedHex = colorSelect.value;
                    const selectedFabric = fabricSelect?.value || '';
                    const colorObj = availableColors.find(c => c.hex === selectedHex);
                    if (colorObj) {
                        // Find the fabric item from inventory to get price
                        const fabricItem = (AppState.inventoryManagementItems || []).find(i =>
                            i.category === 'Fabric' &&
                            (selectedFabric ? (i.name || '').includes(selectedFabric) : true) &&
                            (i.color === selectedHex || i.name.includes(colorObj.name))
                        );

                        AppState.newQuotation.colors.push({
                            hex: colorObj.hex,
                            name: colorObj.name,
                            fabricTypes: colorObj.fabricTypes || [],
                            yards: parseFloat(totalYards.toFixed(2)),
                            fabricSku: fabricItem?.sku || '',
                            fabricPrice: fabricItem?.unitPrice || 0
                        });
                    }
                }
            });
        }
    }
    if (current === 6) {
        AppState.newQuotation.accessories = [];
        const accessoriesCats = ['Accessory', 'Button', 'Zipper', 'Fastener', 'Yarn'];
        const availableAccessories = (AppState.inventoryManagementItems || []).filter(i => accessoriesCats.includes(i.category));
        document.querySelectorAll('#q_accessoriesBody tr').forEach(row => {
            const typeSelect = row.cells[0]?.querySelector('select');
            const priceInput = row.cells[1]?.querySelector('input[type="number"]');
            const qtyInput = row.cells[2]?.querySelector('input[type="number"]');
            if (typeSelect && typeSelect.value && priceInput && priceInput.value && qtyInput && qtyInput.value) {
                const selectedAcc = availableAccessories.find(a => a.sku === typeSelect.value);
                if (selectedAcc) {
                    AppState.newQuotation.accessories.push({
                        sku: selectedAcc.sku,
                        name: selectedAcc.name,
                        price: parseFloat(priceInput.value) || 0,
                        quantity: parseInt(qtyInput.value) || 0,
                        color: selectedAcc.color || null
                    });
                }
            }
        });
    }

    // Skip step 6 for CMT orders when going back
    if (current === 7 && orderType === 'CMT') {
        AppState.newQuotation.step = 5;
    } else {
        AppState.newQuotation.step = Math.max(1, current - 1);
    }

    // Handle both page and modal contexts
    const modal = document.querySelector('#modalContainer .modal.active');
    const pageBody = document.querySelector('.quotation-page-body');

    const bodyElement = pageBody || (modal && modal.querySelector('.modal-body'));
    if (!bodyElement) return;

    bodyElement.innerHTML = getOrderQuotationStepContent(AppState.newQuotation.step);
    updateQuotationStepper(AppState.newQuotation.step);
    attachQuotationHandlers();

    // Restore form field data for basic steps
    if (AppState.newQuotation.step === 1) {
        setTimeout(() => restoreQuotationFormData(1), 50);
    } else if (AppState.newQuotation.step === 2) {
        setTimeout(() => restoreQuotationFormData(2), 50);
    }

    // Restore table data and trigger post-navigation handlers
    if (AppState.newQuotation.step === 4) {
        setTimeout(() => {
            restoreQuotationTableData();
        }, 50);
    }

    // Re-populate approval sheet when going back to step 6
    if (AppState.newQuotation.step === 6) {
        setTimeout(() => populateQuotationApprovalPreview(), 100);
    }

    // Recalculate costing when going back to step 7
    if (AppState.newQuotation.step === 7) {
        setTimeout(() => calculateQuotationCosting(), 100);
    }

    // Re-populate review when going back to step 8
    if (AppState.newQuotation.step === 8) {
        setTimeout(() => populateQuotationReview(), 100);
    }
}

function updateQuotationStepper(currentStep) {
    // Handle both page and modal contexts
    const modal = document.querySelector('#modalContainer .modal.active');
    const container = modal || document.querySelector('.quotation-page-container');

    const stepItems = container.querySelectorAll('.step-item');

    // Hide step 6 for CMT orders (costing step)
    const orderType = AppState.newQuotation.selectedOrderType;
    const costingStep = Array.from(stepItems).find(item => item.getAttribute('data-step') === '6');
    if (costingStep) {
        costingStep.style.display = orderType === 'CMT' ? 'none' : '';
    }

    stepItems.forEach((step) => {
        const stepNum = parseInt(step.getAttribute('data-step'));
        step.classList.remove('active', 'completed');

        if (stepNum < currentStep) {
            step.classList.add('completed');
        } else if (stepNum === currentStep) {
            step.classList.add('active');
        }
    });
}

function selectQuotationOrderType(type) {
    AppState.newQuotation.selectedOrderType = type;
    const cards = document.querySelectorAll('.q-order-type-card');
    cards.forEach((card) => {
        const cardText = card.textContent.trim();
        const isSelected = (cardText.startsWith('FOB') && type === 'FOB') || (cardText.startsWith('CMT') && type === 'CMT');

        if (isSelected) {
            card.style.borderColor = '#D4AF37';
            card.style.borderWidth = '3px';
            card.style.backgroundColor = 'rgba(212, 175, 55, 0.15)';
            card.style.boxShadow = '0 0 0 2px rgba(212, 175, 55, 0.3)';
            card.classList.add('q-order-type-card-selected');
        } else {
            card.style.borderColor = '#ddd';
            card.style.borderWidth = '2px';
            card.style.backgroundColor = 'transparent';
            card.style.boxShadow = 'none';
            card.classList.remove('q-order-type-card-selected');
        }
    });
}

function selectQuotationDeliveryType(type) {
    AppState.newQuotation.deliveryType = type;
    const cards = document.querySelectorAll('.q-order-type-card');

    // Toggle visibility of address field based on delivery type
    const addressGroup = document.getElementById('q_addressGroup');
    const addressInput = document.getElementById('q_address');
    if (addressGroup) {
        if (type === 'for_pickup') {
            addressGroup.style.display = 'none';
            if (addressInput) addressInput.removeAttribute('required');
        } else {
            addressGroup.style.display = '';
            if (addressInput) addressInput.setAttribute('required', 'required');
        }
    }

    cards.forEach((card) => {
        const cardText = card.textContent.trim();
        const isSelected = (cardText.includes('For Delivery') && type === 'for_delivery') || (cardText.includes('For Pick Up') && type === 'for_pickup');

        if (isSelected) {
            card.style.borderColor = '#D4AF37';
            card.style.borderWidth = '3px';
            card.style.backgroundColor = 'rgba(212, 175, 55, 0.15)';
            card.style.boxShadow = '0 0 0 2px rgba(212, 175, 55, 0.3)';
            card.classList.add('q-order-type-card-selected');
        } else {
            card.style.borderColor = '#ddd';
            card.style.borderWidth = '2px';
            card.style.backgroundColor = 'transparent';
            card.style.boxShadow = 'none';
            card.classList.remove('q-order-type-card-selected');
        }
    });
}

function attachQuotationHandlers() {
    // Get the container (modal or page)
    const container = document.querySelector('#modalContainer .modal.active') || document.querySelector('.quotation-page-container');
    if (!container) return;

    // Handle garment type change to update size options
    const garmentTypeSelect = container.querySelector('#q_garmentType');
    if (garmentTypeSelect) {
        garmentTypeSelect.addEventListener('change', (e) => {
            const garmentType = e.target.value;
            AppState.newQuotation.garmentType = garmentType;

            // Update all size selects in the table with new options
            const sizeSelects = container.querySelectorAll('#q_sizeBreakdownBody select');
            const availableSizes = getSizeOptionsForGarment(garmentType);

            sizeSelects.forEach(select => {
                const currentValue = select.value;
                select.innerHTML = availableSizes.map(size => `<option value="${size}" ${size === currentValue ? 'selected' : ''}>${size}</option>`).join('');
            });

            // Update color yards when garment type changes
            updateAllColorYards();
        });
    }

    // File upload handlers
    const zone = container.querySelector('#q_fileUploadZone');
    const input = container.querySelector('#q_fileInput');
    if (zone && input) {
        zone.addEventListener('click', () => input.click());
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); zone.style.borderColor = 'var(--accent)'; });
        zone.addEventListener('dragleave', () => { zone.classList.remove('dragover'); zone.style.borderColor = 'var(--border)'; });
        zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); zone.style.borderColor = 'var(--border)'; handleQuotationFiles(e.dataTransfer.files); });
        input.addEventListener('change', e => handleQuotationFiles(e.target.files));
    }

    // Restore saved table data from AppState or initialize empty color rows
    restoreQuotationTableData();

    // Add listeners to size quantity inputs to update color yards dynamically
    const sizeQtyInputs = container.querySelectorAll('#q_sizeBreakdownBody input[type="number"]');
    sizeQtyInputs.forEach(input => {
        input.addEventListener('change', updateAllColorYards);
        input.addEventListener('input', updateAllColorYards);
    });
}

function restoreQuotationTableData() {
    const container = document.querySelector('#modalContainer .modal.active') || document.querySelector('.quotation-page-container');
    if (!container) return;

    const sizeBody = container.querySelector('#q_sizeBreakdownBody');
    if (sizeBody && AppState.newQuotation.sizes && AppState.newQuotation.sizes.length > 0) {
        Array.from(sizeBody.querySelectorAll('tr')).forEach(r => r.remove());
        const garmentType = AppState.newQuotation?.garmentType || '';
        const availableSizes = getSizeOptionsForGarment(garmentType);
        AppState.newQuotation.sizes.forEach(s => {
            const tr = document.createElement('tr');
            const sizeOpts = availableSizes.map(o => `<option value="${o}" ${o === s.size ? 'selected' : ''}>${o}</option>`).join('');
            const qty = s.quantity || 1;
            tr.innerHTML = `<td style="padding:0.75rem;border-bottom:1px solid var(--border);"><select style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;">${sizeOpts}</select></td><td style="padding:0.75rem;border-bottom:1px solid var(--border);"><input type="number" class="q-size-qty" style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;" min="1" value="${qty}"></td><td style="padding:0.75rem;border-bottom:1px solid var(--border);"><button type="button" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:1.25rem;" onclick="removeQuotationSizeRow(this)">×</button></td>`;
            sizeBody.appendChild(tr);

            // Add listener to quantity input to update colors yards
            const qtyInput = tr.querySelector('.q-size-qty');
            if (qtyInput) {
                qtyInput.addEventListener('change', updateAllColorYards);
                qtyInput.addEventListener('input', updateAllColorYards);
            }
        });
    }

    const colorBody = container.querySelector('#q_colorBreakdownBody');
    if (colorBody && AppState.newQuotation.colors && AppState.newQuotation.colors.length > 0) {
        colorBody.innerHTML = '';
        const availableColors = getAvailableColors();

        // Get all unique fabric types
        const allFabricTypes = new Set();
        availableColors.forEach(c => {
            (c.fabricTypes || []).forEach(ft => allFabricTypes.add(ft));
        });
        const fabricTypeArray = Array.from(allFabricTypes).sort();

        AppState.newQuotation.colors.forEach(c => {
            const tr = document.createElement('tr');
            const selectedColor = availableColors.find(col => col.hex === c.hex) || { hex: c.hex, name: '', fabricTypes: [] };
            const selectedFabricTypes = selectedColor.fabricTypes || [];
            const firstFabricType = selectedFabricTypes.length > 0 ? selectedFabricTypes[0] : '';

            // Filter colors by selected fabric type
            const colorsForFabric = firstFabricType
                ? availableColors.filter(col => (col.fabricTypes || []).includes(firstFabricType))
                : availableColors;

            const fabricTypeOptions = fabricTypeArray.map(ft => `<option value="${ft}" ${selectedFabricTypes.includes(ft) ? 'selected' : ''}>${ft}</option>`).join('');
            const colorOptions = colorsForFabric.map(col => {
                const priceDisplay = col.unitPrice > 0 ? ` - ₱${col.unitPrice.toFixed(2)}/yard` : '';
                return `<option value="${col.hex}" ${col.hex === c.hex ? 'selected' : ''} data-price="${col.unitPrice}">${col.name}${priceDisplay}</option>`;
            }).join('');
            const initialPrice = colorsForFabric.find(col => col.hex === c.hex)?.unitPrice || 0;
            const priceText = initialPrice > 0 ? `₱${initialPrice.toFixed(2)}/yard` : '';

            tr.innerHTML = `<td style="padding:0.75rem;border-bottom:1px solid var(--border);"><select class="q-input q-fabric-select" style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;"><option value="">-- Select Fabric --</option>${fabricTypeOptions}</select></td><td style="padding:0.75rem;border-bottom:1px solid var(--border);"><select class="q-input q-color-select" style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;"><option value="">-- Select Color --</option>${colorOptions}</select></td><td style="padding:0.75rem;border-bottom:1px solid var(--border);"><div style="display:flex;flex-direction:column;gap:0.25rem;"><span style="font-weight:600;color:var(--navy-dark);">${c.yards} yards</span><span class="q-fabric-price-display" style="font-size:0.9rem;color:var(--text-muted);">${priceText}</span></div></td><td style="padding:0.75rem;border-bottom:1px solid var(--border);"><div class="color-preview" style="width:40px;height:40px;border-radius:6px;border:2px solid var(--border);background:${c.hex};"></div></td><td style="padding:0.75rem;border-bottom:1px solid var(--border);"><button type="button" style="background:none;border:none;color:var(--navy-dark);cursor:pointer;font-size:1.25rem;font-weight:bold;" onclick="removeQuotationColorRow(this)">×</button></td>`;
            colorBody.appendChild(tr);

            const fabricSelect = tr.querySelector('.q-fabric-select');
            const colorSelect = tr.querySelector('.q-color-select');
            const pr = tr.querySelector('.color-preview');

            if (fabricSelect && colorSelect) {
                fabricSelect.addEventListener('change', (e) => {
                    const selectedFabricType = e.target.value;
                    // Filter colors by selected fabric type
                    const colorsForFabric = selectedFabricType
                        ? availableColors.filter(col => (col.fabricTypes || []).includes(selectedFabricType))
                        : availableColors;

                    // Reset color select options
                    colorSelect.innerHTML = '<option value="">-- Select Color --</option>' +
                        colorsForFabric.map(col => `<option value="${col.hex}">${col.name}</option>`).join('');

                    // Reset color display
                    if (pr) pr.style.background = '#FFFFFF';
                });
            }

            if (colorSelect && pr) {
                colorSelect.addEventListener('change', (e) => {
                    const selectedHex = e.target.value;
                    const priceDisplay = tr.querySelector('.q-fabric-price-display');
                    if (selectedHex) {
                        const selectedColorObj = availableColors.find(col => col.hex === selectedHex);
                        if (selectedColorObj) {
                            pr.style.background = selectedColorObj.hex;
                            // Display the fabric price
                            if (priceDisplay && selectedColorObj.unitPrice > 0) {
                                priceDisplay.textContent = `₱${selectedColorObj.unitPrice.toFixed(2)}/yard`;
                            } else if (priceDisplay) {
                                priceDisplay.textContent = '';
                            }
                        }
                    } else {
                        pr.style.background = '#FFFFFF';
                        if (priceDisplay) priceDisplay.textContent = '';
                    }
                });
            }
        });
    } else if (colorBody && colorBody.children.length === 0) {
        addQuotationColorRow();
    }
}

function handleQuotationFiles(files) {
    Array.from(files).forEach(f => {
        const existing = AppState.newQuotation.files.find(x => x.name === f.name);
        if (!existing) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const fileObj = { name: f.name, size: f.size, type: f.type, data: e.target.result };
                const existingIdx = AppState.newQuotation.files.findIndex(x => x.name === f.name);
                if (existingIdx >= 0) {
                    AppState.newQuotation.files[existingIdx] = fileObj;
                } else {
                    AppState.newQuotation.files.push(fileObj);
                }
                updateFileList();
            };
            reader.readAsDataURL(f);
        }
    });
    updateFileList();
}

function updateFileList() {
    const list = document.querySelector('#q_fileList');
    if (!list) return;
    list.innerHTML = AppState.newQuotation.files.map(f => {
        const isImage = /image\/(png|jpg|jpeg|gif|webp)/i.test(f.type);
        return `
        <div class="file-item" style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:0.5rem;">
                <div style="display:flex;align-items:center;gap:0.75rem;flex:1;">
                    <span style="font-size:1.5rem;">${isImage ? '🖼️' : '📄'}</span>
                    <div style="flex:1;">
                        <div style="font-weight:500;">${f.name}</div>
                        <div style="color:var(--text-muted);font-size:0.85rem;">${(f.size / 1024).toFixed(1)} KB</div>
                    </div>
                </div>
                <button type="button" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:1.25rem;" onclick="removeQuotationFile('${f.name}')">×</button>
            </div>
        `;
    }).join('');
}

function removeQuotationFile(name) {
    AppState.newQuotation.files = AppState.newQuotation.files.filter(f => f.name !== name);
    updateFileList();
}

function addQuotationSizeRow() {
    const tbody = document.querySelector('#q_sizeBreakdownBody');
    if (!tbody) return;
    const garmentType = AppState.newQuotation?.garmentType || '';
    const sizeOptions = generateSizeSelectOptions(garmentType);
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><select class="q-input" style="width:100%;">${sizeOptions || '<option value="">Select size</option>'}</select></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><input type="number" class="q-input q-size-qty" style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;" min="1" value="1"></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><button type="button" style="background:none;border:none;color:var(--navy-dark);cursor:pointer;font-size:1.5rem;font-weight:bold;" onclick="removeQuotationSizeRow(this)">×</button></td>
    `;
    tbody.appendChild(tr);

    // Add listener to new quantity input to update colors yards
    const qtyInput = tr.querySelector('.q-size-qty');
    if (qtyInput) {
        qtyInput.addEventListener('change', updateAllColorYards);
        qtyInput.addEventListener('input', updateAllColorYards);
    }
}

function removeQuotationSizeRow(btn) {
    if (btn && btn.parentElement && btn.parentElement.parentElement) {
        btn.parentElement.parentElement.remove();
        calculateQuotationCosting();
    }
}

function getAvailableColors() {
    // Get all unique colors from fabric items only with their fabric types and prices
    const colorMap = {
        '#FFFFFF': 'White',
        '#000000': 'Black',
        '#1A1A1A': 'Charcoal',
        '#2C3E50': 'Navy',
        '#34495E': 'Dark Gray',
        '#7F8C8D': 'Gray',
        '#D3D3D3': 'Light Gray',
        '#8B7355': 'Tan/Beige',
        '#DAA520': 'Khaki',
        '#A0826D': 'Brown',
        '#922B3E': 'Burgundy',
        '#C41E3A': 'Red',
        '#FF69B4': 'Hot Pink',
        '#FFB6C1': 'Light Pink',
        '#4B0082': 'Indigo',
        '#1E90FF': 'Royal Blue',
        '#4169E1': 'Cornflower Blue',
        '#00BFFF': 'Sky Blue',
        '#20B2AA': 'Teal',
        '#228B22': 'Forest Green',
        '#008000': 'Green',
        '#7CFC00': 'Lime Green',
        '#FFFF00': 'Yellow',
        '#FFA500': 'Orange',
        '#8B4513': 'Saddle Brown',
        '#808000': 'Olive',
        '#800080': 'Purple',
        '#DDA0DD': 'Plum'
    };

    const colorFabricMap = {};
    const colorPriceMap = {}; // Track unit prices for each color
    (AppState.inventoryManagementItems || []).forEach(item => {
        // Only include colors from fabric items
        if (item.color && item.category === 'Fabric') {
            if (!colorFabricMap[item.color]) {
                colorFabricMap[item.color] = [];
                colorPriceMap[item.color] = parseFloat(item.unitPrice) || 0;
            } else {
                // Use the lowest price among this color's variants, or highest
                const currentPrice = colorPriceMap[item.color];
                const itemPrice = parseFloat(item.unitPrice) || 0;
                // Keep the price (you could also average or pick max)
                colorPriceMap[item.color] = itemPrice > 0 ? itemPrice : currentPrice;
            }

            // Extract fabric type from item name (format: "Fabric - [Type] - [Color]")
            let fabricType = item.name;
            const parts = fabricType.split(' - ');
            if (parts.length >= 2) {
                fabricType = parts[1]; // Get just the type part (e.g., "Cotton")
            }

            if (!colorFabricMap[item.color].includes(fabricType)) {
                colorFabricMap[item.color].push(fabricType);
            }
        }
    });

    // Return array of {hex, name, fabricTypes, unitPrice} for available colors
    return Object.keys(colorFabricMap).map(hex => ({
        hex: hex,
        name: colorMap[hex] || 'Custom',
        fabricTypes: colorFabricMap[hex],
        unitPrice: colorPriceMap[hex] || 0
    }));
}

function updateAllColorYards() {
    const garmentType = AppState.newQuotation?.data?.garmentType || '';
    const yardsPerGarment = getYardsForGarment(garmentType);
    const totalQty = getTotalQuantityFromSizes();
    const totalYards = (yardsPerGarment * totalQty).toFixed(2);

    // Update all yards displays in color breakdown
    document.querySelectorAll('#q_colorBreakdownBody .q-yards-value').forEach(span => {
        span.textContent = `${totalYards} yards`;
    });
}

function getTotalQuantityFromSizes() {
    let totalQty = 0;
    document.querySelectorAll('#q_sizeBreakdownBody tr').forEach(row => {
        const qtyInput = row.querySelector('input[type="number"]');
        if (qtyInput && qtyInput.value) {
            totalQty += parseInt(qtyInput.value) || 0;
        }
    });
    return totalQty || 0;
}

function addQuotationColorRow() {
    const tbody = document.querySelector('#q_colorBreakdownBody');
    if (!tbody) return;
    const tr = document.createElement('tr');

    const availableColors = getAvailableColors();

    // Get all unique fabric types
    const allFabricTypes = new Set();
    availableColors.forEach(c => {
        (c.fabricTypes || []).forEach(ft => allFabricTypes.add(ft));
    });
    const fabricTypeArray = Array.from(allFabricTypes).sort();
    const fabricTypeOptions = fabricTypeArray.map(ft => `<option value="${ft}">${ft}</option>`).join('');

    const colorOptions = availableColors.map(c => {
        const priceDisplay = c.unitPrice > 0 ? ` - ₱${c.unitPrice.toFixed(2)}/yard` : '';
        return `<option value="${c.hex}" data-price="${c.unitPrice}">${c.name}${priceDisplay}</option>`;
    }).join('');
    const firstColorHex = '#FFFFFF';
    const garmentType = AppState.newQuotation?.data?.garmentType || '';
    const yardsPerGarment = getYardsForGarment(garmentType);
    const totalQty = getTotalQuantityFromSizes();
    const totalYards = (yardsPerGarment * totalQty).toFixed(2);

    const yardsSpan = `<span class="q-yards-value" style="font-weight:600;color:var(--navy-dark);"> ${totalYards} yards</span>`;
    const priceSpan = `<span class="q-fabric-price-display" style="font-size:0.9rem;color:var(--text-muted);"></span>`;

    tr.innerHTML = `
        <td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><select class="q-input q-fabric-select" style="width:100%;"><option value="">-- Select Fabric --</option>${fabricTypeOptions}</select></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><select class="q-input q-color-select" style="width:100%;"><option value="">-- Select Color --</option>${colorOptions}</select></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><div style="display:flex;flex-direction:column;gap:0.25rem;">${yardsSpan}${priceSpan}</div></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><div class="color-preview" style="width:40px;height:40px;border-radius:6px;border:2px solid var(--border);background:${firstColorHex};"></div></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border-light);"><button type="button" style="background:none;border:none;color:var(--navy-dark);cursor:pointer;font-size:1.25rem;font-weight:bold;" onclick="removeQuotationColorRow(this)">×</button></td>
    `;
    tbody.appendChild(tr);

    // Add event listeners for fabric type and color sync
    const fabricSelect = tr.querySelector('.q-fabric-select');
    const colorSelect = tr.querySelector('.q-color-select');
    const preview = tr.querySelector('.color-preview');
    const yardsDisplay = tr.querySelector('.q-yards-value');

    if (fabricSelect && colorSelect) {
        fabricSelect.addEventListener('change', (e) => {
            const selectedFabricType = e.target.value;
            // Filter colors by selected fabric type
            const colorsForFabric = selectedFabricType
                ? availableColors.filter(c => (c.fabricTypes || []).includes(selectedFabricType))
                : availableColors;

            // Reset color select options
            colorSelect.innerHTML = '<option value="">-- Select Color --</option>' +
                colorsForFabric.map(c => `<option value="${c.hex}">${c.name}</option>`).join('');

            // Reset color display
            if (preview) preview.style.background = '#FFFFFF';
        });
    }

    if (colorSelect) {
        colorSelect.addEventListener('change', (e) => {
            const selectedHex = e.target.value;
            const priceDisplay = tr.querySelector('.q-fabric-price-display');

            if (selectedHex) {
                try {
                    const selectedColor = availableColors.find(c => c.hex === selectedHex);
                    if (selectedColor && preview) {
                        preview.style.background = selectedColor.hex;
                    }
                    // Display the fabric price
                    if (priceDisplay && selectedColor && selectedColor.unitPrice > 0) {
                        priceDisplay.textContent = `₱${selectedColor.unitPrice.toFixed(2)}/yard`;
                    } else if (priceDisplay) {
                        priceDisplay.textContent = '';
                    }
                } catch (err) {
                    console.error('Error updating color:', err);
                    if (preview) preview.style.background = '#FFFFFF';
                    if (priceDisplay) priceDisplay.textContent = '';
                }
            } else {
                if (preview) preview.style.background = '#FFFFFF';
                if (priceDisplay) priceDisplay.textContent = '';
            }
        });
    }
}

function printApprovalSheet() {
    const approvalContent = document.querySelector('.quotation-form-section');
    if (!approvalContent) {
        showMessage('Error', 'Approval sheet content not found', 'error');
        return;
    }

    const printContent = approvalContent.cloneNode(true);
    const printWindow = window.open('', '', 'height=600, width=900');
    const html = `
        <html style="width:100%;">
        <head>
            <title>Quotation Approval Sheet</title>
            <style>
                body { 
                    font-family: 'Cormorant Garamond', serif;
                    padding: 20px;
                    background: #f5f5f5;
                }
                .print-container { 
                    background: white;
                    padding: 40px;
                    max-width: 850px;
                    margin: 0 auto;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                }
                h1, h2, h3 { color: #1A2332; margin: 0; }
                h1 { font-size: 24px; text-align: center; margin-bottom: 5px; }
                h2 { font-size: 20px; text-align: center; margin-bottom: 10px; }
                h3 { font-size: 16px; margin-top: 20px; margin-bottom: 10px; border-bottom: 2px solid #1A2332; padding-bottom: 10px; }
                p { margin: 5px 0; color: #1A2332; font-size: 14px; line-height: 1.6; }
                strong { font-weight: 600; }
                div { color: #1A2332; }
                .section { margin-bottom: 20px; }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .declaration { margin: 20px 0; padding: 15px; background: #F8F6F1; border-left: 4px solid #1A2332; }
                .signature-section { margin-top: 30px; padding-top: 20px; border-top: 2px solid #1A2332; }
                .sig-line { 
                    width: 300px;
                    margin: 0 auto 10px;
                    height: 40px;
                    border-bottom: 2px solid #1A2332;
                }
                .sig-name { text-align: center; margin-top: 10px; font-weight: 600; }
                .sig-label { text-align: center; margin-top: 5px; font-size: 12px; text-decoration: underline; }
                @media print {
                    body { background: white; padding: 0; }
                    .print-container { box-shadow: none; padding: 20px; }
                }
            </style>
        </head>
        <body>
            <div class="print-container">
                ${printContent.innerHTML}
            </div>
            <script>
                window.setTimeout(() => {
                    window.print();
                    window.setTimeout(() => window.close(), 500);
                }, 250);
            </script>
        </body>
        </html >
        `;
    printWindow.document.write(html);
    printWindow.document.close();
}

function removeQuotationColorRow(btn) {
    if (btn && btn.parentElement && btn.parentElement.parentElement) {
        btn.parentElement.parentElement.remove();
    }
}

function addQuotationAccessoryRow() {
    const tbody = document.querySelector('#q_accessoriesBody');
    if (!tbody) return;
    const tr = document.createElement('tr');

    // Get accessories from inventory - filter by accessory categories
    const accessoriesCats = ['Accessory', 'Button', 'Zipper', 'Fastener', 'Yarn'];
    const availableAccessories = (AppState.inventoryManagementItems || []).filter(i => accessoriesCats.includes(i.category));

    // Build options string with SKU only (no JSON)
    const accessoryOptions = availableAccessories.map(acc =>
        `<option value="${acc.sku}">${acc.name}</option>`
    ).join('');

    tr.innerHTML = `
        <td style="padding:0.75rem;border-bottom:1px solid var(--border);"><select style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;" onchange="updateAccessoryPrice(this)"><option value="">Select accessory</option>${accessoryOptions}</select></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border);"><input type="number" min="0" step="0.01" value="0.00" placeholder="0.00" style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;" onchange="updateAccessoryTotal(this)"></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border);"><input type="number" min="1" value="1" placeholder="0" style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;" onchange="updateAccessoryTotal(this)"></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border);"><div class="accessory-color-swatch" style="width:40px;height:40px;border-radius:6px;border:2px solid var(--border);background:#CCCCCC;"></div></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border);text-align:center;font-weight:600;color:var(--navy-dark);"><span class="accessory-total">₱0.00</span></td>
        <td style="padding:0.75rem;border-bottom:1px solid var(--border);"><button type="button" style="background:none;border:none;color:var(--navy-dark);cursor:pointer;font-size:1.25rem;font-weight:bold;" onclick="removeQuotationAccessoryRow(this)">×</button></td>
    `;
    tbody.appendChild(tr);

    // Add event listener to show color when accessory is selected
    const accessorySelect = tr.querySelector('select');
    if (accessorySelect) {
        accessorySelect.addEventListener('change', (e) => {
            const sku = e.target.value;
            if (sku) {
                const selectedAcc = availableAccessories.find(a => a.sku === sku);
                const colorSwatch = tr.querySelector('.accessory-color-swatch');
                if (colorSwatch && selectedAcc) {
                    if (selectedAcc.color) {
                        colorSwatch.style.background = selectedAcc.color;
                    } else {
                        colorSwatch.style.background = '#CCCCCC';
                    }
                }
            } else {
                const colorSwatch = tr.querySelector('.accessory-color-swatch');
                if (colorSwatch) colorSwatch.style.background = '#CCCCCC';
            }
        });
    }
}

function updateAccessoryPrice(select) {
    const row = select.parentElement.parentElement;
    const priceInput = row.cells[1].querySelector('input');
    const colorSwatch = row.querySelector('.accessory-color-swatch');
    if (!priceInput) return;

    const sku = select.value;
    if (sku) {
        // Get accessories from inventory
        const accessoriesCats = ['Accessory', 'Button', 'Zipper', 'Fastener', 'Yarn'];
        const availableAccessories = (AppState.inventoryManagementItems || []).filter(i => accessoriesCats.includes(i.category));

        const selectedAcc = availableAccessories.find(a => a.sku === sku);
        if (selectedAcc) {
            priceInput.value = parseFloat(selectedAcc.unitPrice || 0).toFixed(2);

            // Update color swatch if color exists
            if (colorSwatch) {
                if (selectedAcc.color) {
                    colorSwatch.style.background = selectedAcc.color;
                } else {
                    colorSwatch.style.background = '#CCCCCC';
                }
            }

            updateAccessoryTotal(priceInput);
        }
    }
}

function removeQuotationAccessoryRow(btn) {
    if (btn && btn.parentElement && btn.parentElement.parentElement) {
        btn.parentElement.parentElement.remove();
        calculateQuotationCosting();
    }
}

function updateAccessoryTotal(input) {
    const row = input.parentElement.parentElement;
    const priceInput = row.cells[1].querySelector('input');
    const qtyInput = row.cells[2].querySelector('input');
    const totalCell = row.cells[4].querySelector('.accessory-total');

    if (priceInput && qtyInput && totalCell) {
        const price = parseFloat(priceInput.value) || 0;
        const qty = parseInt(qtyInput.value) || 0;
        const total = price * qty;
        totalCell.textContent = `₱${total.toFixed(2)} `;
        calculateQuotationCosting();
    }
}

function calculateQuotationCosting() {
    const garmentType = document.querySelector('#q_garmentType')?.value || 'Custom';
    const orderType = AppState.newQuotation.selectedOrderType;
    const isCMT = orderType === 'CMT';

    // Calculate total quantity from size rows
    let totalQty = 0;
    const sizeRows = document.querySelectorAll('#q_sizeBreakdownBody tr');
    sizeRows.forEach(row => {
        const qtyInput = row.querySelector('input[type="number"]');
        if (qtyInput) totalQty += parseInt(qtyInput.value) || 0;
    });

    // Calculate accessories cost from inventory prices
    let accessoriesCost = 0;
    const accRows = document.querySelectorAll('#q_accessoriesBody tr');
    accRows.forEach(row => {
        const costInput = row.cells[1]?.querySelector('input[type="number"]');
        const qtyInput = row.cells[2]?.querySelector('input[type="number"]');
        if (costInput && qtyInput) {
            accessoriesCost += (parseFloat(costInput.value) || 0) * (parseInt(qtyInput.value) || 0);
        }
    });

    // Try to calculate from AppState first (if we're on a later step where DOM tables don't exist)
    if (AppState.newQuotation.sizes && AppState.newQuotation.sizes.length > 0) {
        totalQty = 0;
        AppState.newQuotation.sizes.forEach(s => {
            totalQty += s.quantity || 0;
        });
    }

    // Same for accessories - use AppState if available
    if (AppState.newQuotation.accessories && AppState.newQuotation.accessories.length > 0) {
        accessoriesCost = 0;
        AppState.newQuotation.accessories.forEach(acc => {
            const price = parseFloat(acc.price) || 0;
            const qty = parseInt(acc.quantity) || 0;
            accessoriesCost += price * qty;
        });
    }

    // Calculate fabric cost based on selected colors/fabrics from inventory
    let fabricCost = 0;
    if (!isCMT) {
        // For FOB orders: use actual fabric prices from inventory
        if (AppState.newQuotation.colors && AppState.newQuotation.colors.length > 0) {
            AppState.newQuotation.colors.forEach(color => {
                const yardCost = (parseFloat(color.fabricPrice) || 0) * (parseFloat(color.yards) || 0);
                fabricCost += yardCost;
            });
        } else {
            // Fallback: if no colors selected, use a default
            const garment = BASE_PRICING[garmentType] || BASE_PRICING['Custom'];
            fabricCost = (garment.fabric || 80) * totalQty;
        }
    }

    // Labor cost is always calculated from BASE_PRICING
    const garment = BASE_PRICING[garmentType] || BASE_PRICING['Custom'];
    const laborCost = (garment.labor || 50) * totalQty;

    const overhead = ((fabricCost + laborCost + accessoriesCost) * 0.15);
    const subtotalWithOverhead = fabricCost + laborCost + accessoriesCost + overhead;
    const profitMarginPct = parseFloat(document.querySelector('#q_profitMargin')?.value || 0.25);
    const profit = subtotalWithOverhead * profitMarginPct;
    const total = subtotalWithOverhead + profit;

    // Update display only if elements exist
    const formatCurrency = (val) => `₱${val.toFixed(2)} `;
    const fabricCostEl = document.querySelector('#q_fabricCost');
    const laborCostEl = document.querySelector('#q_laborCost');
    const accCostEl = document.querySelector('#q_accCost');
    const overheadEl = document.querySelector('#q_overhead');
    const subtotalEl = document.querySelector('#q_subtotal');
    const profitEl = document.querySelector('#q_profitAmount');
    const totalEl = document.querySelector('#q_totalQuotation');

    if (fabricCostEl) fabricCostEl.textContent = formatCurrency(fabricCost);
    if (laborCostEl) laborCostEl.textContent = formatCurrency(laborCost);
    if (accCostEl) accCostEl.textContent = formatCurrency(accessoriesCost);
    if (overheadEl) overheadEl.textContent = formatCurrency(overhead);
    if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotalWithOverhead);
    if (profitEl) profitEl.textContent = formatCurrency(profit);
    if (totalEl) totalEl.textContent = formatCurrency(total);

    // Store for submission
    AppState.newQuotation.data.totalAmount = total;
    AppState.newQuotation.data.totalQty = totalQty;
}

function populateQuotationApprovalPreview() {
    const d = AppState.newQuotation.data || {};

    // Customer Information
    const custName = d.customerName || '-';
    const el1 = document.querySelector('#q_appr_custName');
    const el2 = document.querySelector('#q_appr_custName_sign');
    const el3 = document.querySelector('#q_appr_contact');
    const el4 = document.querySelector('#q_appr_email');
    const el5 = document.querySelector('#q_appr_address');
    const el6 = document.querySelector('#q_appr_orderType');
    const el7 = document.querySelector('#q_appr_garment');
    const el8 = document.querySelector('#q_appr_qty');
    const el9 = document.querySelector('#q_appr_sizes');
    const el10 = document.querySelector('#q_appr_colors');
    const el11 = document.querySelector('#q_appr_accessories');
    const el12 = document.querySelector('#q_appr_designFiles');

    if (el1) el1.textContent = custName;
    if (el2) el2.textContent = custName;
    if (el3) el3.textContent = d.contactNumber || '-';
    if (el4) el4.textContent = d.email || '-';
    if (el5) el5.textContent = d.address || '-';

    // Order Details
    if (el6) el6.textContent = AppState.newQuotation.selectedOrderType || '-';
    if (el7) el7.textContent = d.garmentType || '-';

    // Calculate total quantity from saved sizes
    let totalQty = 0;
    const sizes = AppState.newQuotation.sizes || [];
    sizes.forEach(s => {
        totalQty += s.quantity || 0;
    });
    if (el8) el8.textContent = totalQty + ' pcs';

    // Sizes from AppState
    let sizesText = '';
    sizes.forEach(s => {
        if (s.size && s.quantity) {
            sizesText += s.size + ': ' + s.quantity + ' pcs; ';
        }
    });
    if (el9) el9.textContent = sizesText || 'Not specified';

    // Colors from AppState (show swatches + names + fabric types + yards)
    const colors = AppState.newQuotation.colors || [];
    let colorsHTML = '';
    colors.forEach(c => {
        if (c.name && c.yards) {
            const hex = c.hex || '#ffffff';
            const fabricTypes = (c.fabricTypes || []).join(', ');
            colorsHTML += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;"><div style="width:20px;height:20px;border-radius:4px;border:1px solid var(--border);background:${hex};"></div><div><div style="font-weight:600;">${c.name}</div><div style="font-size:0.85rem;color:var(--text-muted);">${fabricTypes}</div></div><div style="color:var(--text-muted);margin-left:0.75rem;">${c.yards} yards</div></div>`;
        }
    });
    if (el10) el10.innerHTML = colorsHTML || 'Not specified';

    // Accessories from AppState (with color swatches)
    let accessoriesHTML = '';
    const accessories = AppState.newQuotation.accessories || [];
    accessories.forEach(a => {
        if (a.name && a.quantity) {
            const color = a.color || '#CCCCCC';
            accessoriesHTML += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;"><div style="width:20px;height:20px;border-radius:4px;border:1px solid var(--border);background:${color};"></div><div style="font-weight:600;">${a.name}</div><div style="color:var(--text-muted);margin-left:0.75rem;">${a.quantity} pcs</div></div>`;
        }
    });
    if (el11) el11.innerHTML = accessoriesHTML || 'None';

    // Design Files from AppState
    let designFilesHTML = '';
    const files = AppState.newQuotation.files || [];
    if (files.length > 0) {
        designFilesHTML = files.map(f => {
            const isImage = /image\/(png|jpg|jpeg|gif|webp)/i.test(f.type);
            if (isImage) {
                return `<div style="margin-bottom:0.75rem;"><img src="${f.data}" style="max-width:100%;max-height:150px;border:1px solid var(--border);border-radius:4px;"></div>`;
            } else {
                return `<div style="padding:0.5rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;margin-bottom:0.5rem;color:var(--navy-dark);">📄 ${f.name}</div>`;
            }
        }).join('');
    } else {
        designFilesHTML = '<p style="color:var(--text-muted);">No design files uploaded</p>';
    }
    if (el12) el12.innerHTML = designFilesHTML;
}

function populateQuotationReview() {
    const d = AppState.newQuotation.data || {};
    const orderType = AppState.newQuotation.selectedOrderType;
    const isCMT = orderType === 'CMT';

    // Get total quantity
    let totalQty = 0;
    const sizes = AppState.newQuotation.sizes || [];
    sizes.forEach(s => {
        totalQty += s.quantity || 0;
    });

    // Get costing values - calculate from selected fabrics and accessories from inventory
    // Calculate fabric cost based on selected colors/fabrics
    let fabricCost = 0;
    if (!isCMT) {
        if (AppState.newQuotation.colors && AppState.newQuotation.colors.length > 0) {
            AppState.newQuotation.colors.forEach(color => {
                const yardCost = (parseFloat(color.fabricPrice) || 0) * (parseFloat(color.yards) || 0);
                fabricCost += yardCost;
            });
        } else {
            // Fallback: if no colors selected, use default
            const garmentType = d.garmentType || 'Custom';
            const garment = BASE_PRICING[garmentType] || BASE_PRICING['Custom'];
            fabricCost = (garment.fabric || 80) * totalQty;
        }
    }

    // Labor cost from BASE_PRICING
    const garmentType = d.garmentType || 'Custom';
    const garment = BASE_PRICING[garmentType] || BASE_PRICING['Custom'];
    const laborCost = (garment.labor || 50) * totalQty;

    // Accessories cost from AppState
    let accessoriesCost = 0;
    const accessories = AppState.newQuotation.accessories || [];
    accessories.forEach(a => {
        accessoriesCost += (a.price || 0) * (a.quantity || 0);
    });

    const subtotal = fabricCost + laborCost + accessoriesCost;
    const overhead = subtotal * 0.15;
    const subtotalWithOverhead = subtotal + overhead;

    const profitMargin = parseFloat(d.profitMargin) || 0.25;
    const profitAmount = subtotalWithOverhead * profitMargin;
    const totalAmount = subtotalWithOverhead + profitAmount;

    // Update review elements
    const custEl = document.querySelector('#review_customer');
    const deliveryEl = document.querySelector('#review_deliveryType');
    const orderEl = document.querySelector('#review_orderType');
    const garmentEl = document.querySelector('#review_garment');
    const qtyEl = document.querySelector('#review_qty');
    const fabricEl = document.querySelector('#review_fabricCost');
    const laborEl = document.querySelector('#review_laborCost');
    const accEl = document.querySelector('#review_accCost');
    const overheadEl = document.querySelector('#review_overhead');
    const subtotalEl = document.querySelector('#review_subtotal');
    const profitEl = document.querySelector('#review_profitAmount');
    const totalEl = document.querySelector('#review_totalAmount');

    if (custEl) custEl.textContent = d.customerName || '-';
    if (deliveryEl) deliveryEl.textContent = (AppState.newQuotation.deliveryType === 'for_pickup' ? 'For Pick Up' : 'For Delivery') || '-';
    if (orderEl) orderEl.textContent = AppState.newQuotation.selectedOrderType || '-';
    if (garmentEl) garmentEl.textContent = d.garmentType || '-';
    if (qtyEl) qtyEl.textContent = totalQty;
    if (fabricEl) fabricEl.textContent = '₱' + fabricCost.toFixed(2);
    if (laborEl) laborEl.textContent = '₱' + laborCost.toFixed(2);
    if (accEl) accEl.textContent = '₱' + accessoriesCost.toFixed(2);
    if (overheadEl) overheadEl.textContent = '₱' + overhead.toFixed(2);
    if (subtotalEl) subtotalEl.textContent = '₱' + subtotalWithOverhead.toFixed(2);
    if (profitEl) profitEl.textContent = '₱' + profitAmount.toFixed(2);
    if (totalEl) totalEl.textContent = '₱' + totalAmount.toFixed(2);
}

function saveQuotationStepData(step) {
    const d = AppState.newQuotation.data || {};
    if (step === 1) {
        d.customerName = document.getElementById('q_customerName')?.value;
        d.contactNumber = document.getElementById('q_contactNumber')?.value;
        d.email = document.getElementById('q_email')?.value;
        d.address = document.getElementById('q_address')?.value;
        d.deliveryType = AppState.newQuotation.deliveryType || 'for_delivery';
    } else if (step === 2) {
        d.orderType = AppState.newQuotation.selectedOrderType;
        d.garmentType = document.getElementById('q_garmentType')?.value;
    } else if (step === 7) {
        d.profitMargin = document.getElementById('q_profitMargin')?.value;
        d.leadTime = document.getElementById('q_leadTime')?.value;
    }
    AppState.newQuotation.data = d;
}

function restoreQuotationFormData(step) {
    const d = AppState.newQuotation.data || {};
    if (step === 1) {
        const customerNameEl = document.getElementById('q_customerName');
        const contactNumberEl = document.getElementById('q_contactNumber');
        const emailEl = document.getElementById('q_email');
        const addressEl = document.getElementById('q_address');
        const addressGroup = document.getElementById('q_addressGroup');

        if (customerNameEl && d.customerName) customerNameEl.value = d.customerName;
        if (contactNumberEl && d.contactNumber) contactNumberEl.value = d.contactNumber;
        if (emailEl && d.email) emailEl.value = d.email;
        if (addressEl && d.address) addressEl.value = d.address;

        // Restore delivery type and address visibility
        if (d.deliveryType) {
            AppState.newQuotation.deliveryType = d.deliveryType;
            selectQuotationDeliveryType(d.deliveryType);
        }
    } else if (step === 2) {
        const garmentTypeEl = document.getElementById('q_garmentType');
        if (garmentTypeEl && d.garmentType) garmentTypeEl.value = d.garmentType;

        // Restore selected order type card visual
        if (AppState.newQuotation.selectedOrderType) {
            selectQuotationOrderType(AppState.newQuotation.selectedOrderType);
        }
    }
}

async function submitQuotationFromModal() {
    saveQuotationStepData(8);
    // Ensure quotation costing is calculated before submission
    calculateQuotationCosting();
    const d = AppState.newQuotation.data || {};

    // Check required fields and mark them visually
    let hasErrors = false;
    const requiredFields = [
        { id: 'q_customerName', label: 'Customer Name', value: d.customerName },
        { id: 'q_contactNumber', label: 'Contact Number', value: d.contactNumber },
        { id: 'q_garmentType', label: 'Garment Type', value: d.garmentType }
    ];

    // Clear previous error markings
    document.querySelectorAll('.q-input, .q-textarea, .q-select').forEach(el => {
        el.style.borderColor = '';
        el.style.boxShadow = '';
    });

    // Check and mark empty fields
    requiredFields.forEach(field => {
        if (!field.value || field.value.trim() === '') {
            hasErrors = true;
            const el = document.getElementById(field.id);
            if (el) {
                el.style.borderColor = '#dc3545';
                el.style.boxShadow = '0 0 0 0.2rem rgba(220, 53, 69, 0.25)';
            }
        }
    });

    // Check if at least one size is added (check AppState first, then DOM)
    let hasSizes = false;
    if (AppState.newQuotation.sizes && AppState.newQuotation.sizes.length > 0) {
        hasSizes = true;
    } else {
        const sizeRows = document.querySelectorAll('#q_sizeBreakdownBody tr');
        if (sizeRows && sizeRows.length > 0) {
            hasSizes = true;
        }
    }

    if (!hasSizes) {
        hasErrors = true;
        showMessage('Validation Error', 'Please add at least one size', 'warning');
    }

    if (hasErrors) {
        showMessage('Validation Error', 'Please fill in all required fields (marked in red)', 'warning');
        return;
    }

    // Calculate total qty (check AppState first, then DOM)
    let totalQty = 0;
    if (AppState.newQuotation.sizes && AppState.newQuotation.sizes.length > 0) {
        AppState.newQuotation.sizes.forEach(s => {
            totalQty += s.quantity || 0;
        });
    } else {
        document.querySelectorAll('#q_sizeBreakdownBody tr').forEach(row => {
            const qtyInput = row.querySelector('input[type="number"]');
            if (qtyInput) totalQty += parseInt(qtyInput.value) || 0;
        });
    }
    d.totalQty = totalQty;
    AppState.newQuotation.data = d;

    // Show loading while we persist the new order
    showLoading('Submitting order...');
    console.log('Quotation submitted:', AppState.newQuotation);

    const newOrder = {
        orderId: `ORD - ${new Date().getFullYear()} - ${String(AppState.orderCounter++).padStart(4, '0')}`,
        customerName: d.customerName,
        customerPhone: d.contactNumber,
        customerEmail: d.email,
        garmentType: d.garmentType,
        orderType: AppState.newQuotation.selectedOrderType,
        deliveryType: AppState.newQuotation.deliveryType || 'for_delivery',
        quantity: totalQty,
        deliveryDate: d.deliveryDate,
        deliveryAddress: d.deliveryAddress || d.address || '',
        quotedAmount: d.totalAmount,
        status: document.querySelector('#q_status')?.value || 'draft',
        createdDate: new Date().toLocaleDateString(),
        createdBy: AppState.currentUser?.username || 'system',
        files: AppState.newQuotation.files,
        sizes: AppState.newQuotation.sizes || [],
        colors: AppState.newQuotation.colors || [],
        accessories: AppState.newQuotation.accessories || []
    };

    AppState.orders.push(newOrder);

    try {
        await syncDataToFirestore();
    } catch (err) {
        hideLoading();
        console.error('Error saving order:', err);
        showMessage('Error', 'Failed to submit order: ' + (err.message || err), 'error');
        return;
    }

    hideLoading();
    closeModal();
    renderOrdersTable();
    updateDashboardStats();

    // Show success message with next step suggestion
    const modal = createModal('Order Created Successfully! ✅', `
        <div style="padding: 1.5rem; text-align: center;">
            <div style="margin-bottom: 1.5rem;">
                <p style="font-size: 1rem; margin: 0.5rem 0; color: #333;">
                    <strong>Order:</strong> ${newOrder.orderId}
                </p>
                <p style="font-size: 1rem; margin: 0.5rem 0; color: #333;">
                    <strong>Garment:</strong> ${newOrder.garmentType} (${totalQty} pcs)
                </p>
                <p style="font-size: 1rem; margin: 0.5rem 0; color: #666; font-size: 0.95rem;">
                    Job Order will be created when you create a production batch.
                </p>
            </div>
            <div style="margin: 1.5rem 0; padding: 1rem; background: #FFF3CD; border-radius: 4px; border-left: 4px solid #F39C12;">
                <p style="margin: 0; color: #856404; font-size: 0.95rem;">
                    <strong>Next Step:</strong> Go to <strong>Production & Quality</strong> and create a batch for this order. This will automatically create the job order.
                </p>
            </div>
            <div style="display: flex; gap: 0.75rem; justify-content: center; margin-top: 1.5rem;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem;">View Orders</button>
                <button class="btn btn-primary" onclick="closeModal(); navigateTo('production')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Go to Production →</button>
            </div>
        </div>
        `);
    const modalContainer = document.getElementById('modalContainer');
    modalContainer.innerHTML = '';
    modalContainer.appendChild(modal);

    // Reset quotation form and reload the quotation page
    AppState.newQuotation = {
        step: 1,
        clientName: '',
        contactNumber: '',
        orderType: 'fob',
        files: [],
        sizes: [],
        colors: [],
        accessories: [],
        notes: '',
        costingData: {}
    };

    // Reload the quotation page with empty form
    loadQuotationPageContent();
}

function openDeleteAccountModal() {
    const modal = createModal('Delete Account', `
        <div style="padding: 1.5rem;">
            <div style="background: #FFF3CD; border: 1px solid #FFE69C; padding: 1rem; border-radius: 6px; margin-bottom: 1.5rem;">
                <p style="margin: 0; color: #856404; font-weight: 500;">⚠️ This action cannot be undone!</p>
                <p style="margin: 0.5rem 0 0 0; color: #856404; font-size: 0.9rem;">Your user account (login credentials and profile) will be permanently deleted. System records you created will remain and can be managed by other administrators.</p>
            </div>
            
            <form id="deleteAccountForm">
                <div class="form-group">
                    <label style="font-weight: 600; margin-bottom: 0.5rem; display: block;">To confirm, type the following:</label>
                    <div style="background: #F5F5F5; padding: 0.75rem; border-radius: 4px; margin-bottom: 0.5rem; font-family: monospace; font-weight: 600; color: #333;">DELETE ACCOUNT</div>
                    <input type="text" id="deleteConfirmation" class="q-input" placeholder="Type above text to confirm" style="width: 100%; padding: 0.75rem; border: 1px solid #DDD; border-radius: 4px; font-size: 1rem;">
                </div>
                
                <div style="margin-top: 1.5rem; display: flex; gap: 0.75rem;">
                    <button type="button" class="btn-secondary" onclick="closeModal()" style="flex: 1;">Cancel</button>
                    <button type="submit" class="btn-primary" style="flex: 1; background: #E74C3C; color: white;" id="deleteAccountBtn">Delete My Account</button>
                </div>
            </form>
        </div>
        `);

    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    const confirmInput = document.getElementById('deleteConfirmation');
    const deleteBtn = document.getElementById('deleteAccountBtn');

    // Enable/disable delete button based on confirmation input
    confirmInput.addEventListener('input', () => {
        if (confirmInput.value === 'DELETE ACCOUNT') {
            deleteBtn.disabled = false;
            deleteBtn.style.opacity = '1';
            deleteBtn.style.cursor = 'pointer';
        } else {
            deleteBtn.disabled = true;
            deleteBtn.style.opacity = '0.5';
            deleteBtn.style.cursor = 'not-allowed';
        }
    });

    // Set initial state - button disabled
    deleteBtn.disabled = true;
    deleteBtn.style.opacity = '0.5';
    deleteBtn.style.cursor = 'not-allowed';

    document.getElementById('deleteAccountForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        if (confirmInput.value !== 'DELETE ACCOUNT') {
            showMessage('Error', 'Please type "DELETE ACCOUNT" to confirm', 'error');
            return;
        }

        try {
            // Get current user
            const user = firebaseAuth.currentUser;
            if (!user) {
                showMessage('Error', 'User not found', 'error');
                return;
            }

            // Firebase requires reauthentication before deleting account
            // Show password modal
            const userEmail = user.email;
            const password = await showPasswordModal(userEmail);

            if (!password) {
                showMessage('Cancelled', 'Account deletion cancelled', 'info');
                return;
            }

            // Reauthenticate with email and password
            const credential = firebase.auth.EmailAuthProvider.credential(userEmail, password);
            await user.reauthenticateWithCredential(credential);

            // Delete Firestore document first
            if (firestore) {
                await firestore.collection('users').doc(user.uid).delete();
            }

            // Then delete Firebase auth account
            await user.delete();

            showMessage('Success', 'Account deleted successfully', 'success');
            closeModal();

            // Redirect to login after 2 seconds
            setTimeout(() => {
                AppState.currentUser = null;
                window.location.href = window.location.pathname;
            }, 2000);
        } catch (error) {
            console.error('Error deleting account:', error);

            // Provide specific error messages
            let errorMsg = error.message;
            if (error.code === 'auth/wrong-password') {
                errorMsg = 'Incorrect password. Please try again.';
            } else if (error.code === 'auth/user-mismatch') {
                errorMsg = 'Email does not match your account.';
            } else if (error.code === 'auth/invalid-credential') {
                errorMsg = 'Invalid credentials. Please try again.';
            }

            showMessage('Error', 'Failed to delete account: ' + errorMsg, 'error');
        }
    });
}

// USER SETTINGS MODALS
function confirmChangePassword() {
    const currentPwd = document.getElementById('currentPasswordInput')?.value || '';
    const newPwd = document.getElementById('newPasswordInput')?.value || '';
    const confirmPwd = document.getElementById('confirmNewPasswordInput')?.value || '';

    // Basic validation before showing confirmation
    if (!currentPwd) {
        const errEl = document.getElementById('changePasswordError');
        if (errEl) { errEl.textContent = 'Please enter your current password.'; errEl.style.display = 'block'; }
        return;
    }
    if (!newPwd || newPwd.length < 6) {
        const errEl = document.getElementById('changePasswordError');
        if (errEl) { errEl.textContent = 'New password must be at least 6 characters.'; errEl.style.display = 'block'; }
        return;
    }
    if (newPwd !== confirmPwd) {
        const errEl = document.getElementById('changePasswordError');
        if (errEl) { errEl.textContent = 'New password and confirmation do not match.'; errEl.style.display = 'block'; }
        return;
    }

    // Show confirmation modal
    const confirmModal = createModal('Confirm Password Change', `
        <div style="padding:1.5rem;text-align:center;">
            <div style="margin-bottom:1rem;font-size:2rem;color:var(--gold-primary);">
                ⚠️
            </div>
            <p style="font-size:1rem;color:var(--navy-dark);line-height:1.6;margin-bottom:1.5rem;">
                Are you sure you want to change your password?<br>
                <span style="font-size:0.9rem;color:var(--text-muted);">This will update your account password immediately.</span>
            </p>
            <div style="display:flex;gap:1rem;justify-content:center;">
                <button type="button" class="btn-secondary" onclick="closeConfirmModal()" style="flex:1;padding:0.7rem 1.5rem;background:#F0F0F0;color:var(--navy-dark);border:2px solid #DDD;border-radius:6px;font-weight:600;cursor:pointer;transition:all 0.2s ease;font-family:'Cormorant Garamond',serif;letter-spacing:0.05em;font-size:0.9rem;">Cancel</button>
                <button type="button" class="btn-primary" onclick="handleChangePassword()" style="flex:1;padding:0.7rem 1.5rem;background:linear-gradient(135deg,var(--gold-primary),var(--gold-dark));color:white;border:none;border-radius:6px;font-weight:600;cursor:pointer;transition:all 0.2s ease;font-family:'Cormorant Garamond',serif;letter-spacing:0.05em;font-size:0.9rem;">Confirm Change</button>
            </div>
        </div>
    `);

    confirmModal.id = 'confirmPasswordModal';
    document.getElementById('modalContainer').appendChild(confirmModal);
    confirmModal.classList.add('active');
}

function closeConfirmModal() {
    const confirmModal = document.getElementById('confirmPasswordModal');
    if (confirmModal) {
        confirmModal.classList.remove('active');
        setTimeout(() => confirmModal.remove(), 300);
    }
}

async function handleChangePassword() {
    const errEl = document.getElementById('changePasswordError');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    const currentPwd = document.getElementById('currentPasswordInput')?.value || '';
    const newPwd = document.getElementById('newPasswordInput')?.value || '';
    const confirmPwd = document.getElementById('confirmNewPasswordInput')?.value || '';

    const btn = document.getElementById('changePasswordBtn');
    const originalText = btn ? btn.textContent : '';

    if (!currentPwd) {
        if (errEl) { errEl.textContent = 'Please enter your current password.'; errEl.style.display = 'block'; }
        return;
    }
    if (!newPwd || newPwd.length < 6) {
        if (errEl) { errEl.textContent = 'New password must be at least 6 characters.'; errEl.style.display = 'block'; }
        return;
    }
    if (newPwd !== confirmPwd) {
        if (errEl) { errEl.textContent = 'New password and confirmation do not match.'; errEl.style.display = 'block'; }
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }

    try {
        if (!auth || !auth.currentUser) {
            if (errEl) { errEl.textContent = 'Authentication not available. Please log in again.'; errEl.style.display = 'block'; }
            if (btn) { btn.disabled = false; btn.textContent = originalText; }
            return;
        }

        const userEmail = AppState.currentUser?.email || auth.currentUser.email;
        // Reauthenticate
        const credential = firebase.auth.EmailAuthProvider.credential(userEmail, currentPwd);
        await auth.currentUser.reauthenticateWithCredential(credential);

        // Update password
        await auth.currentUser.updatePassword(newPwd);

        // Close both modals
        closeConfirmModal();
        setTimeout(() => {
            closeModal();
            showMessage('Success', 'Password changed successfully.', 'success');
        }, 300);
    } catch (error) {
        console.error('Change password error:', error);
        let msg = error && error.message ? error.message : 'Failed to change password.';
        if (error.code === 'auth/wrong-password') msg = 'Current password is incorrect.';
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
}

function openManageAccountsModal() {
    const modal = createLargeModal('Manage User Accounts', `
        <div class="accounts-header">
            <div class="search-box">
                <input type="text" placeholder="Search users...">
            </div>
            <button class="btn-primary" onclick="showMessage('Add User', 'This feature will be implemented soon', 'info')">+ Add User</button>
        </div>
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Username</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>admin</td>
                        <td><span class="role-badge role-administrator">Administrator</span></td>
                        <td><span class="status-badge status-in-stock">Active</span></td>
                        <td>
                            <button class="action-btn action-btn-edit">Edit</button>
                        </td>
                    </tr>
                    <tr>
                        <td>staff</td>
                        <td><span class="role-badge role-staff">Staff</span></td>
                        <td><span class="status-badge status-in-stock">Active</span></td>
                        <td>
                            <button class="action-btn action-btn-edit">Edit</button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    `);

    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

// ==========================================
// PACKAGING MODULE
// ==========================================
function loadPackagingContent() {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
        <div style="padding:0;">
            <div class="content-area" style="padding:24px 32px;">
                <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);">
                    <div class="stat-card">
                        <div class="stat-label">Total Orders Ready</div>
                        <div id="pkg_ordersReady" class="stat-value">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Pending Packaging</div>
                        <div id="pkg_pending" class="stat-value">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Packaged Orders</div>
                        <div id="pkg_completed" class="stat-value">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Ready for Delivery or Pickup</div>
                        <div id="pkg_readyDelivery" class="stat-value">0</div>
                    </div>
                </div>

                <div class="search-section" style="margin-top:20px;">
                    <h3>Find Orders for Packaging</h3>
                    <div class="search-row" style="margin-top:12px;">
                        <input id="pkg_search" class="search-input" type="text" placeholder="Search by Order ID or Customer..." onkeyup="filterPackagingOrders()">
                        <select id="pkg_status_filter" class="status-filter" onchange="filterPackagingOrders()">
                            <option value="">All Status</option>
                            <option value="production_complete">Ready for Packaging</option>
                            <option value="packaging_in_progress">Packaging in Progress</option>
                            <option value="packaged">Packaged</option>
                            <option value="ready_for_delivery">Ready for Delivery</option>
                        </select>
                    </div>
                </div>

                <div class="orders-section" style="margin-top:20px;">
                    <div class="section-header">
                        <h2>Orders Ready for Packaging</h2>
                    </div>
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Order ID</th>
                                    <th>Customer</th>
                                    <th>Delivery Type</th>
                                    <th>Garment Type</th>
                                    <th>Quantity</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="pkg_ordersBody">
                                <tr>
                                    <td colspan="7">
                                        <div class="empty-state">
                                            <div class="empty-icon-wrapper">
                                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                                            </div>
                                            <h3>No orders ready for packaging</h3>
                                            <p>Orders will appear here once they complete quality control</p>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;
    renderPackagingOrders();
}

function renderPackagingOrders() {
    const body = document.getElementById('pkg_ordersBody');
    // If tbody is not yet parsed/available, retry a few times (handles timing/parsing races)
    if (!body) {
        window._pkgRenderRetries = (window._pkgRenderRetries || 0) + 1;
        if (window._pkgRenderRetries <= 10) {
            console.warn('pkg_ordersBody not found, retrying renderPackagingOrders()', window._pkgRenderRetries);
            setTimeout(renderPackagingOrders, 100);
            return;
        } else {
            console.error('pkg_ordersBody not found after retries');
        }
    }
    if (!body) return;

    // Get orders that are ready for packaging
    // For delivery orders: show through packaged and ready_for_delivery stages
    // For pickup orders: show through packaged and ready_for_pickup stages (mirror delivery flow)
    const orders = (AppState.orders || []).filter(o => {
        if (o.status === 'production_complete') return true;
        if (o.deliveryType === 'for_delivery' && (o.status === 'packaged' || o.status === 'ready_for_delivery')) return true;
        if (o.deliveryType === 'for_pickup' && (o.status === 'packaged' || o.status === 'ready_for_pickup')) return true;
        return false;
    });

    if (orders.length === 0) {
        body.innerHTML = '<tr style="border-bottom:1px solid var(--border);"><td colspan="7" style="padding:0.75rem;text-align:center;color:var(--text-muted);">No orders ready for packaging</td></tr>';
        return;
    }

    body.innerHTML = orders.map(o => {
        const status = o.status || 'pending';
        const deliveryType = o.deliveryType || 'for_delivery';
        const deliveryDisplay = deliveryType === 'for_pickup' ? 'Pick Up' : 'Delivery';
        const deliveryBadge = `<span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:${deliveryType === 'for_pickup' ? '#E3F2FD' : '#C8E6C9'};color:${deliveryType === 'for_pickup' ? '#1976D2' : '#2E7D32'};border-radius:3px;">${deliveryDisplay}</span>`;
        const statusBadge = `<span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#E8F5E9;color:#2E7D32;border-radius:3px;"> ${status.replace(/_/g, ' ')}</span>`;
        return `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:0.5rem;">${o.orderId || 'N/A'}</td>
            <td style="padding:0.5rem;">${o.customerName || '-'}</td>
            <td style="padding:0.5rem;">${deliveryBadge}</td>
            <td style="padding:0.5rem;">${o.garmentType || '-'}</td>
            <td style="padding:0.5rem;">${o.quantity || 0}</td>
            <td style="padding:0.5rem;">${statusBadge}</td>
            <td style="padding:0.5rem;">
                <button class="action-btn action-btn-view" onclick="openPackagingDetailsModal('${o.orderId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">View</button>
                ${(() => {
                if (o.status === 'production_complete') {
                    const batch = (AppState.productions || []).find(p => p.orderRef === o.orderId || p.jobOrderRef === o.orderId);
                    if (!batch) return '';
                    if (batch.qcStatus === 'passed') {
                        return `<button class="action-btn action-btn-edit" onclick="markPackagingComplete('${o.orderId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">Packaged</button>`;
                    } else if (batch.qcStatus === 'failed') {
                        return `<span style="font-size:0.75rem;padding:0.3rem 0.6rem;background:#FFCCBC;color:#D84315;border-radius:3px;">❌ QC Failed</span>`;
                    } else {
                        // pending
                        return `<span style="font-size:0.75rem;padding:0.3rem 0.6rem;background:#FFF4E5;color:#F39C12;border-radius:3px;">⏳ Pending QC</span>`;
                    }
                }
                return '';
            })()}
                ${(() => {
                if (o.status === 'packaged') {
                    if (o.deliveryType === 'for_delivery' || !o.deliveryType) {
                        return `<button class="action-btn action-btn-delete" onclick="markReadyForDelivery('${o.orderId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">Ready</button>`;
                    }
                    if (o.deliveryType === 'for_pickup') {
                        return `<button class="action-btn action-btn-delete" onclick="markReadyForPickup('${o.orderId}')" style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-right:0.25rem;">Ready</button>`;
                    }
                }
                return '';
            })()}
            </td>
        </tr>`;
    }).join('');

    // Update stats (all orders)
    const stats = {
        // combined ready (delivery or pickup)
        readyForAny: AppState.orders.filter(o => o.status === 'ready_for_delivery' || o.status === 'ready_for_pickup').length,
        pendingPickup: AppState.orders.filter(o => o.status === 'ready_for_pickup').length,
        pendingPackaging: AppState.orders.filter(o => o.status === 'production_complete').length,
        packaged: AppState.orders.filter(o => o.status === 'packaged').length
    };

    const elTotal = document.getElementById('pkg_ordersReady');
    const elPending = document.getElementById('pkg_pending');
    const elPackaged = document.getElementById('pkg_completed');
    const elReady = document.getElementById('pkg_readyDelivery');

    // 'Total Orders Ready' should reflect orders ready for delivery or pickup
    if (elTotal) elTotal.textContent = stats.readyForAny;
    if (elPending) elPending.textContent = stats.pendingPackaging;
    if (elPackaged) elPackaged.textContent = stats.packaged;
    if (elReady) elReady.textContent = stats.readyForAny;
}

function filterPackagingOrders() {
    const search = document.getElementById('pkg_search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('pkg_status_filter')?.value || '';

    const rows = document.querySelectorAll('#pkg_ordersBody tr');
    rows.forEach(row => {
        if (row.textContent.toLowerCase().includes(search) && (!statusFilter || row.textContent.includes(statusFilter))) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

async function markPackagingComplete(orderId) {
    const order = AppState.orders.find(o => o.orderId === orderId);
    if (!order) return;

    const modal = createModal('Confirm Packaging Complete', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Mark order <strong>${orderId}</strong> as packaged?</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">Item: <strong>${order.garmentType}</strong> (${order.quantity} pcs)</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="markPackagingCompleteConfirmed('${orderId}')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Confirm</button>
            </div>
        </div>
        `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function markPackagingCompleteConfirmed(orderId) {
    showLoading('Marking as packaged...');
    try {
        // Update order status
        const order = AppState.orders.find(o => o.orderId === orderId);
        if (order) {
            order.status = 'packaged';
        }

        // Update related batch if exists
        const batch = AppState.productions.find(p => p.orderRef === orderId);
        if (batch) {
            batch.stage = 'Packing';
            batch.packedDate = new Date().toLocaleDateString('en-US');
        }

        await syncDataToFirestore();
        hideLoading();
        renderPackagingOrders();
        showMessage('Success', 'Order marked as packaged!', 'success');
        closeModal();
    } catch (error) {
        hideLoading();
        console.error('Error marking as packaged:', error);
        showMessage('Error', 'Failed to update order: ' + error.message, 'error');
    }
}

async function markReadyForDelivery(orderId) {
    const order = AppState.orders.find(o => o.orderId === orderId);
    if (!order) return;

    const modal = createModal('Confirm Ready for Delivery', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Mark order <strong>${orderId}</strong> as ready for delivery?</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">Item: <strong>${order.garmentType}</strong> (${order.quantity} pcs)</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="markReadyForDeliveryConfirmed('${orderId}')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Confirm</button>
            </div>
        </div>
        `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function markReadyForDeliveryConfirmed(orderId) {
    showLoading('Marking as ready for delivery and creating delivery record...');
    try {
        // Update order status
        const order = AppState.orders.find(o => o.orderId === orderId);
        if (!order) {
            hideLoading();
            showMessage('Error', 'Order not found', 'error');
            return;
        }

        order.status = 'ready_for_delivery';

        // Update related batch if exists
        const batch = AppState.productions.find(p => p.orderRef === orderId);
        if (batch) {
            batch.stage = 'Ready for Delivery';
            batch.readyDate = new Date().toLocaleDateString('en-US');
        }

        // Do not auto-create a delivery here; deliveries are created manually from the Deliveries page
        // Reserve/remove items from Inventory Catalog since they're now allocated/reserved
        if (batch && batch.batchId) {
            // Use same SKU format as when QC added produced items (`PROD-{batchId}`)
            const producedSku = `PROD-${batch.batchId}`;
            const catalogIndex = (AppState.inventoryCatalogItems || []).findIndex(i => i.sku === producedSku);
            if (catalogIndex !== -1) {
                const catalogItem = AppState.inventoryCatalogItems[catalogIndex];
                catalogItem.quantity = Math.max(0, (catalogItem.quantity || 0) - (order.quantity || 0));
                if (catalogItem.quantity === 0) {
                    AppState.inventoryCatalogItems.splice(catalogIndex, 1);
                }
            }
        }

        await syncDataToFirestore();
        hideLoading();
        renderPackagingOrders();
        if (typeof renderOrderCatalog === 'function') renderOrderCatalog();
        if (typeof updateInventoryStatistics === 'function') updateInventoryStatistics();
        updateDashboardStats();

        closeModal();
        showMessage('Success', 'Order marked as ready for delivery. Create the delivery manually in Deliveries when ready.', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error marking ready:', error);
        showMessage('Error', 'Failed to update order: ' + error.message, 'error');
    }
}

function openAddPackagingModal() {
    // Open modal to create a packaging entry for a production batch
    const available = (AppState.productions || []).filter(p => ['quality_passed', 'packaging_pending'].includes(p.stage));
    if (available.length === 0) {
        showMessage('No Batches', 'There are no production batches ready for packaging.', 'info');
        return;
    }

    const options = available.map(p => `<option value="${p.batchId}">${p.batchId} — ${p.garmentType} (${p.quantity} pcs)</option>`).join('');
    const modal = createModal('Add Packaging Entry', `
        <div style="padding:1rem;">
            <form id="addPackagingForm">
                <div style="margin-bottom:0.75rem;">
                    <label style="display:block;margin-bottom:0.25rem;color:#666">Select Batch</label>
                    <select id="pkg_batch" style="width:100%;padding:0.5rem;border:1px solid #DDD;border-radius:4px;">${options}</select>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.75rem;">
                    <div>
                        <label style="display:block;margin-bottom:0.25rem;color:#666">Packager</label>
                        <input type="text" id="pkg_packager" style="width:100%;padding:0.5rem;border:1px solid #DDD;border-radius:4px;" placeholder="Name" />
                    </div>
                    <div>
                        <label style="display:block;margin-bottom:0.25rem;color:#666">Boxes</label>
                        <input type="number" id="pkg_boxes" min="0" value="1" style="width:100%;padding:0.5rem;border:1px solid #DDD;border-radius:4px;" />
                    </div>
                </div>
                <div style="margin-bottom:0.75rem;">
                    <label style="display:block;margin-bottom:0.25rem;color:#666">Notes</label>
                    <textarea id="pkg_notes" style="width:100%;padding:0.5rem;border:1px solid #DDD;border-radius:4px;" rows="3"></textarea>
                </div>
                <div style="text-align:right;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary" style="margin-left:0.5rem;">Create Packaging</button>
                </div>
            </form>
        </div>
        `);

    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');

    document.getElementById('addPackagingForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const batchId = document.getElementById('pkg_batch').value;
        const packager = document.getElementById('pkg_packager').value || (AppState.currentUser?.username || 'packager');
        const boxes = parseInt(document.getElementById('pkg_boxes').value) || 0;
        const notes = document.getElementById('pkg_notes').value || '';

        const batch = AppState.productions.find(b => b.batchId === batchId);
        if (!batch) {
            showMessage('Error', 'Selected batch not found', 'error');
            return;
        }

        // Create or update packaging metadata on the production batch
        batch.stage = 'packaging_pending';
        batch.packaging = batch.packaging || {};
        batch.packaging.packager = packager;
        batch.packaging.boxes = boxes;
        batch.packaging.notes = notes;
        batch.packaging.createdDate = new Date().toLocaleDateString();
        batch.packaging.createdBy = AppState.currentUser?.username || 'system';

        await syncDataToFirestore();
        closeModal();
        renderPackagingOrders();
        showMessage('Success', 'Packaging entry created for ' + batchId, 'success');
    });
}

function markReadyForPickup(orderId) {
    const order = AppState.orders.find(o => o.orderId === orderId);
    if (!order) return;
    const modal = createModal('Confirm Ready for Pickup', `
        <div style="padding: 1rem; text-align: center;">
            <p style="margin-bottom: 1rem; font-size: 1rem; color: #333;">Mark order <strong>${orderId}</strong> as ready for pickup?</p>
            <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">Item: <strong>${order.garmentType}</strong> (${order.quantity} pcs)</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.75rem 1.5rem; background: #95a5a6;">Cancel</button>
                <button class="btn btn-primary" onclick="markReadyForPickupConfirmed('${orderId}')" style="padding: 0.75rem 1.5rem; background: #27AE60;">Confirm</button>
            </div>
        </div>
        `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

async function markReadyForPickupConfirmed(orderId) {
    showLoading('Marking as ready for pickup...');
    try {
        const order = AppState.orders.find(o => o.orderId === orderId);
        if (!order) {
            hideLoading();
            showMessage('Error', 'Order not found', 'error');
            return;
        }

        order.status = 'ready_for_pickup';

        // Update related batch if exists
        const batch = AppState.productions.find(p => p.orderRef === orderId);
        if (batch) {
            batch.stage = 'Ready for Pickup';
            batch.readyDate = new Date().toLocaleDateString('en-US');
        }

        await syncDataToFirestore();
        hideLoading();
        renderPackagingOrders();
        updateDashboardStats();
        updateBillingBadges();
        closeModal();
        showMessage('Success', 'Order marked as ready for pickup. Create an invoice when ready.', 'success');
    } catch (error) {
        hideLoading();
        console.error('Error marking ready for pickup:', error);
        showMessage('Error', 'Failed to update order: ' + error.message, 'error');
    }
}

function openPackagingDetailsModal(orderId) {
    // Show order + production details in modal
    const order = AppState.orders.find(o => o.orderId === orderId) || {};
    const prod = AppState.productions.find(p => p.orderRef === orderId);

    if (!order || !prod) {
        return showMessage('Not Found', 'Order or production batch not found', 'error');
    }

    const deliveryType = order.deliveryType || 'for_delivery';
    const deliveryDisplay = deliveryType === 'for_pickup' ? 'Pick Up' : 'Delivery';

    const modal = createModal('Packaging Details - ' + orderId, `
        <div style="padding:1rem;max-height:520px;overflow:auto;">
            <div style="margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid #ddd;">
                <h3 style="margin:0 0 1rem 0;">Order Details</h3>
                <p><strong>Order ID:</strong> ${order.orderId}</p>
                <p><strong>Customer:</strong> ${order.customerName || '-'}</p>
                <p><strong>Delivery Type:</strong> <span style="display:inline-block;padding:0.25rem 0.5rem;background:${deliveryType === 'for_pickup' ? '#E3F2FD' : '#C8E6C9'};color:${deliveryType === 'for_pickup' ? '#1976D2' : '#2E7D32'};border-radius:3px;">${deliveryDisplay}</span></p>
                ${deliveryType === 'for_delivery' ? `<p><strong>Delivery Address:</strong> ${order.deliveryAddress || '-'}</p>` : '<p><strong>Pick Up Location:</strong> <em>To be confirmed at warehouse</em></p>'}
                <p><strong>Garment Type:</strong> ${order.garmentType || '-'}</p>
                <p><strong>Quantity:</strong> ${order.quantity || 0} pcs</p>
                <p><strong>Status:</strong> ${order.status.replace(/_/g, ' ')}</p>
            </div>
            <div style="margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid #ddd;">
                <h3 style="margin:0 0 1rem 0;">Production Batch</h3>
                <p><strong>Batch ID:</strong> ${prod.batchId}</p>
                <p><strong>Stage:</strong> ${prod.currentStage || '-'}</p>
                <p><strong>Progress:</strong> ${prod.progress || 0}%</p>
                <p><strong>Assigned Worker:</strong> ${prod.assignedWorker || '-'}</p>
                <p><strong>Created:</strong> ${prod.createdDate}</p>
            </div>
            <div style="margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid #ddd;">
                <h3 style="margin:0 0 1rem 0;">Design Files</h3>
                ${(() => {
            const files = order.files || [];
            if (files.length === 0) {
                return '<p style="margin: 0.5rem 0; color: #999; font-style: italic;">No design files uploaded</p>';
            }
            return '<div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.75rem;">' +
                files.map(f => {
                    const isImage = /image\/(png|jpg|jpeg|gif|webp)/i.test(f.type);
                    if (isImage) {
                        return `<div style="border: 1px solid #ddd; border-radius: 4px; overflow: hidden; max-width:100%;"><img src="${f.data}" style="max-width: 100%; max-height: 200px; display: block;"></div>`;
                    } else {
                        return `<div style="padding: 0.75rem; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; color: #666; font-size: 0.9rem;">📄 ${f.name}</div>`;
                    }
                }).join('') +
                '</div>';
        })()}
            </div>
            <div style="margin-top:1rem;text-align:center;">
                <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            </div>
        </div>
        `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

// =====================
// Smoke test helper
// =====================
async function runSmokeTest() {
    if (!AppState.currentUser || !firestore) {
        console.error('Must be signed in to run smoke test');
        return;
    }

    console.log('Starting smoke test...');
    // Create a test order
    const testOrder = {
        orderId: `ORD - TEST - ${Date.now()} `,
        customerName: 'Smoke Test Co',
        customerEmail: 'smoketest@example.com',
        garmentType: 'T-Shirt',
        quantity: 10,
        status: 'draft',
        createdDate: new Date().toLocaleDateString(),
        createdBy: AppState.currentUser.username
    };

    AppState.orders.push(testOrder);
    await syncDataToFirestore();
    console.log('Test order pushed and synced:', testOrder.orderId);

    // Read back directly from Firestore to verify
    try {
        const doc = await firestore.collection('users').doc(AppState.currentUser.uid).get();
        const data = doc.data() || {};
        const found = (data.orders || []).find(o => o.orderId === testOrder.orderId);
        if (found) console.log('Verified write in Firestore for order:', found.orderId);
        else console.warn('Order not found in Firestore after sync.');
    } catch (err) {
        console.error('Error verifying Firestore write:', err);
    }

    // Edit the order locally and persist
    const o = AppState.orders.find(x => x.orderId === testOrder.orderId);
    if (o) {
        o.status = 'processing';
        await syncDataToFirestore();
        console.log('Order updated locally and synced.');
    }

    // Final verification
    try {
        const doc2 = await firestore.collection('users').doc(AppState.currentUser.uid).get();
        const data2 = doc2.data() || {};
        const found2 = (data2.orders || []).find(o => o.orderId === testOrder.orderId && o.status === 'processing');
        if (found2) console.log('Final verification success: order status updated in Firestore');
        else console.warn('Final verification failed: status not updated in Firestore');
    } catch (err) {
        console.error('Error in final verification:', err);
    }
}

// ==========================================
// SMS NOTIFICATIONS MODULE
// ==========================================
function loadSMSNotificationsContent() {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
        <div style="padding:0.5rem;overflow-x:hidden;">
            <!--Page Header-->
            <div style="margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:2px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
                <div>
                    <h2 style="margin:0;color:var(--navy-dark);font-size:2rem;">SMS Notifications</h2>
                    <p style="margin:0.5rem 0 0 0;color:var(--text-muted);font-size:0.9rem;">Automated client delivery status updates</p>
                </div>
                <div>
                    <button class="btn btn-secondary" onclick="openSMSConfigModal()" style="margin-right:0.5rem;padding:0.4rem 0.75rem;">Configure SMS</button>
                </div>
            </div>

            <!--SMS Stats (2-column grid)-->
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;margin-bottom:1.5rem;">
                <div style="background:white;padding:1rem;border-left:4px solid var(--gold-primary);border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                    <div style="font-size:0.8rem;color:var(--text-muted);font-weight:500;margin-bottom:0.5rem;">Total Sent</div>
                    <div style="font-size:2rem;font-weight:700;color:var(--navy-dark);" id="sms_totalSent">0</div>
                </div>
                <div style="background:white;padding:1rem;border-left:4px solid var(--gold-primary);border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                    <div style="font-size:0.8rem;color:var(--text-muted);font-weight:500;margin-bottom:0.5rem;">Pending</div>
                    <div style="font-size:2rem;font-weight:700;color:var(--navy-dark);" id="sms_pending">0</div>
                </div>
                <div style="background:white;padding:1rem;border-left:4px solid var(--gold-primary);border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                    <div style="font-size:0.8rem;color:var(--text-muted);font-weight:500;margin-bottom:0.5rem;">Delivered</div>
                    <div style="font-size:2rem;font-weight:700;color:var(--navy-dark);" id="sms_delivered">0</div>
                </div>
                <div style="background:white;padding:1rem;border-left:4px solid var(--gold-primary);border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                    <div style="font-size:0.8rem;color:var(--text-muted);font-weight:500;margin-bottom:0.5rem;">Failed</div>
                    <div style="font-size:2rem;font-weight:700;color:var(--navy-dark);" id="sms_failed">0</div>
                </div>
            </div>

            <!--Send SMS Section-- >
            <div style="background:white;padding:1rem;border-radius:6px;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <h3 style="margin:0 0 0.75rem 0;color:var(--navy-dark);font-size:1rem;font-weight:600;">Send Notification</h3>
                <p style="margin:0 0 0.75rem 0;font-size:0.85rem;color:var(--text-muted);">Notify clients about delivery status updates</p>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem;margin-bottom:0.75rem;">
                    <select id="sms_delivery" style="padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;background:white;color:var(--text-muted);">
                        <option value="">Select Delivery...</option>
                    </select>
                    <select id="sms_template" style="padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;background:white;color:var(--text-muted);" onchange="updateSMSPreview()">
                        <option value="ready">Ready for Pickup</option>
                        <option value="transit">Out for Delivery</option>
                        <option value="delivered">Delivered Successfully</option>
                        <option value="custom">Custom Message</option>
                    </select>
                </div>
                <textarea id="sms_message" placeholder="Message preview..." rows="3" 
                    style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;background:white;color:var(--text-muted);font-family:monospace;resize:vertical;"></textarea>
                <div style="margin-top:0.5rem;font-size:0.8rem;color:var(--text-muted);">Character count: <span id="sms_charCount">0</span>/160</div>
                <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
                    <button class="action-btn action-btn-view" onclick="sendSMSNotification()" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Send SMS</button>
                    <button class="action-btn action-btn-edit" onclick="testSMS()" style="font-size:0.75rem;padding:0.3rem 0.6rem;">Test Message</button>
                </div>
            </div>

            <!--SMS History-- >
        <div style="background:white;padding:1rem;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <h3 style="margin:0 0 0.75rem 0;color:var(--navy-dark);font-size:1rem;font-weight:600;">SMS History</h3>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                    <thead>
                        <tr style="background:var(--cream);border-bottom:2px solid var(--border);">
                            <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Recipient</th>
                            <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Phone</th>
                            <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Message Type</th>
                            <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Sent Date</th>
                            <th style="padding:0.5rem;text-align:left;color:var(--navy-dark);font-weight:600;">Status</th>
                        </tr>
                    </thead>
                    <tbody id="sms_historyBody">
                        <tr><td colspan="5" style="padding:0.75rem;text-align:center;color:var(--text-muted);">No notifications sent yet</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
        </div>
        `;
    renderSMSOverview();
    loadSMSHistory();
}

function renderSMSOverview() {
    if (!AppState.smsNotifications) AppState.smsNotifications = [];

    const stats = {
        total: AppState.smsNotifications.length,
        pending: AppState.smsNotifications.filter(s => s.status === 'pending').length,
        delivered: AppState.smsNotifications.filter(s => s.status === 'delivered').length,
        failed: AppState.smsNotifications.filter(s => s.status === 'failed').length
    };

    document.getElementById('sms_totalSent').textContent = stats.total;
    document.getElementById('sms_pending').textContent = stats.pending;
    document.getElementById('sms_delivered').textContent = stats.delivered;
    document.getElementById('sms_failed').textContent = stats.failed;
}

function loadSMSHistory() {
    const body = document.getElementById('sms_historyBody');
    if (!body) return;

    if (!AppState.smsNotifications || AppState.smsNotifications.length === 0) {
        body.innerHTML = '<tr style="border-bottom:1px solid var(--border);"><td colspan="5" style="padding:0.75rem;text-align:center;color:var(--text-muted);">No notifications sent yet</td></tr>';
        return;
    }

    body.innerHTML = AppState.smsNotifications.slice().reverse().slice(0, 20).map(sms => {
        const statusBadge = `<span style="font-size:0.8rem;padding:0.25rem 0.5rem;background:#E8F5E9;color:#2E7D32;border-radius:3px;"> ${sms.status}</span>`;
        return `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:0.5rem;">${sms.recipientName || '-'}</td>
            <td style="padding:0.5rem;">${sms.phone || '-'}</td>
            <td style="padding:0.5rem;">${sms.type || 'delivery_update'}</td>
            <td style="padding:0.5rem;">${sms.sentDate || '-'}</td>
            <td style="padding:0.5rem;">${statusBadge}</td>
        </tr>`;
    }).join('');
}

function updateSMSPreview() {
    const template = document.getElementById('sms_template')?.value || 'ready';
    const templates = {
        ready: 'Hello! Your order is ready for pickup at Golden Threads Garments. Please visit our store at your earliest convenience. Thank you!',
        transit: 'Your order is out for delivery today. Our driver will arrive shortly. Please ensure someone is available to receive it.',
        delivered: 'Your order has been successfully delivered. Thank you for choosing Golden Threads Garments! We appreciate your business.',
        custom: 'Enter your custom message here...'
    };

    const msg = templates[template] || '';
    const msgEl = document.getElementById('sms_message');
    if (msgEl) {
        msgEl.value = msg;
        document.getElementById('sms_charCount').textContent = msg.length;
    }
}

async function sendSMSNotification() {
    const deliveryId = document.getElementById('sms_delivery')?.value;
    const message = document.getElementById('sms_message')?.value;

    if (!message || message.length === 0) {
        alert('Please enter a message');
        return;
    }

    if (!AppState.smsNotifications) AppState.smsNotifications = [];

    // Build notification record
    const notification = {
        id: 'SMS-' + Date.now(),
        phone: document.getElementById('sms_delivery_phone')?.value || ('+63' + Math.random().toString().slice(2, 12)),
        recipientName: document.getElementById('sms_delivery_name')?.value || 'Customer',
        message: message,
        type: document.getElementById('sms_template')?.value || 'custom',
        status: 'pending',
        sentDate: new Date().toLocaleDateString('en-US'),
        sentTime: new Date().toLocaleTimeString()
    };

    AppState.smsNotifications.push(notification);
    renderSMSOverview();
    loadSMSHistory();

    // Persist the request immediately
    await syncDataToFirestore();

    // If a provider endpoint is configured, send through provider
    if (AppState.smsConfig && AppState.smsConfig.endpoint && AppState.smsConfig.enabled) {
        try {
            // update status to sending
            notification.status = 'sending';
            await syncDataToFirestore();

            const res = await sendSMSThroughProvider(notification, deliveryId);
            if (res && res.success) {
                notification.status = res.status || 'delivered';
                notification.providerId = res.providerId || null;
            } else {
                notification.status = 'failed';
            }
        } catch (err) {
            console.error('SMS provider send failed:', err);
            notification.status = 'failed';
        }
    } else {
        // Simulation path: mark as sent (simulated)
        notification.status = 'sent';
    }

    // Persist final status
    await syncDataToFirestore();
    document.getElementById('sms_message').value = '';
    document.getElementById('sms_charCount').textContent = '0';
    renderSMSOverview();
    loadSMSHistory();
    alert('✓ SMS notification queued' + (notification.status === 'failed' ? ' (failed)' : ''));
}

// Open SMS configuration modal
function openSMSConfigModal() {
    const cfg = AppState.smsConfig || { enabled: false, endpoint: '' };
    const modal = createModal('SMS Provider Configuration', `
        <div style="padding:1rem;">
        <div style="margin-bottom:0.75rem;">
            <label style="display:block;font-size:0.9rem;color:#666;margin-bottom:0.25rem;">Enable Provider</label>
            <input type="checkbox" id="sms_cfg_enabled" ${cfg.enabled ? 'checked' : ''} />
        </div>
        <div style="margin-bottom:0.75rem;">
            <label style="display:block;font-size:0.9rem;color:#666;margin-bottom:0.25rem;">Provider Endpoint (Cloud Function URL)</label>
            <input type="text" id="sms_cfg_endpoint" value="${cfg.endpoint || ''}" style="width:100%;padding:0.5rem;border:1px solid #DDD;border-radius:4px;" placeholder="https://us-central1-.../sendSms" />
            <p style="font-size:0.8rem;color:#888;margin-top:0.5rem;">The endpoint should accept POST JSON { phone, message, type } and return { success:true, providerId }.</p>
        </div>
        <div style="text-align:right;margin-top:0.75rem;">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveSmsConfig()" style="margin-left:0.5rem;">Save</button>
        </div>
    </div>
        `);
    document.getElementById('modalContainer').appendChild(modal);
    modal.classList.add('active');
}

// Save SMS configuration (client-side only)
function saveSmsConfig() {
    const enabled = !!document.getElementById('sms_cfg_enabled')?.checked;
    const endpoint = document.getElementById('sms_cfg_endpoint')?.value || '';
    AppState.smsConfig = { enabled, endpoint };
    // Persist config in user doc (so team members can share settings if needed)
    syncDataToFirestore();
    closeModal();
    showMessage('Saved', 'SMS configuration saved.', 'success');
}

// Send SMS via configured provider endpoint
async function sendSMSThroughProvider(notification, deliveryId) {
    if (!AppState.smsConfig || !AppState.smsConfig.endpoint) throw new Error('No SMS provider endpoint configured');
    const payload = {
        phone: notification.phone,
        message: notification.message,
        type: notification.type,
        deliveryId: deliveryId || null,
        meta: { createdBy: AppState.currentUser?.username || 'system' }
    };

    const res = await fetch(AppState.smsConfig.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const text = await res.text();
        console.error('Provider responded with error:', res.status, text);
        return { success: false };
    }

    const data = await res.json();
    return data;
}

function testSMS() {
    const message = document.getElementById('sms_message')?.value;
    if (!message) {
        alert('Please enter a message first');
        return;
    }
    // TODO: Implement SMS test functionality
}

// ==========================================
// CONSOLE LOGGING
// ==========================================
console.log('%c🔐 GoldenThreads IMS System - Enhanced Version', 'color: #D4AF37; font-size: 16px; font-weight: bold;');
console.log('%c✓ Firebase Authentication Enabled', 'color: #27AE60; font-weight: bold;');
