// Frontend main entry - TypeScript
import './styles/global.css';
import { initApp.vue
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut, 
    onAuthStateChanged,
    sendPasswordResetEmail,
    signInAnonymously,
    updateProfile,
    User,
    getIdToken
} from 'firebase/auth';
import { 
    getFirestore, 
    doc, 
    collection, 
    query, 
    orderBy, 
    getDocs, 
    getDoc, 
    setDoc, 
    deleteDoc,
    where
} from 'firebase/firestore';

// ============================================================
// Firebase Configuration
// ============================================================

const firebaseConfig = {
    apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY || "YOUR_API_KEY",
    authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || "YOUR_PROJECT.firebaseapp.com",
    projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
    storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT.appspot.com",
    messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "YOUR_SENDER_ID",
    appId: import.meta.env.PUBLIC_FIREBASE_APP_ID || "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ============================================================
// Global State
// ============================================================

let currentUser: any = null;
let currentTier: string = 'anonymous';
let selectedFiles: File[] = [];
let estimateTimeout: number | null = null;
const CIRCUMFERENCE = 2 * Math.PI * 54;

// ============================================================
// DOM Elements
// ============================================================

const elements: Record<string, HTMLElement | null> = {
    dropZone: null,
    fileInput: null,
    fileList: null,
    fileItems: null,
    convertBtn: null,
    clearBtn: null,
    loading: null,
    results: null,
    textInput: null,
    convertTextBtn: null,
    charCount: null,
    estimateBox: null,
    charCountEl: null,
    modeSelect: null,
    lineNumbers: null,
    downloadAllBtn: null,
    historyBody: null,
    historySection: null,
    clearHistoryBtn: null,
    imageModal: null,
    modalTitle: null,
    modalImage: null,
    modalClose: null,
    modalDownload: null,
    modalCopy: null,
    authModal: null,
    authModalTitle: null,
    authForm: null,
    authModalClose: null,
    authButtons: null,
    userMenu: null,
    signInBtn: null,
    signUpBtn: null,
    anonBtn: null,
    signOutBtn: null,
    userEmail: null,
    userTier: null,
    manageKeysBtn: null,
    keyManagerModal: null,
    keyList: null,
    newKeyTier: null,
    newKeyDesc: null,
    createKeyBtn: null,
    closeKeyManager: null,
    clearHistoryBtn: null,
    totalConversions: null,
    totalSaved: null,
    avgSavings: null,
    // Text input
    textInput: null,
    convertTextBtn: null,
    charCount: null,
    estimateBox: null,
    // Upload
    dropZone: null,
    fileInput: null,
    fileList: null,
    fileItems: null,
    convertBtn: null,
    clearBtn: null,
    loading: null,
    results: null,
    downloadAllBtn: null,
    historyBody: null,
    clearHistoryBtn: null,
    imageModal: null,
    modalTitle: null,
    modalImage: null,
    modalClose: null,
    modalDownload: null,
    modalCopy: null,
    authModal: null,
    authModalTitle: null,
    authForm: null,
    authModalClose: null,
    authButtons: null,
    userMenu: null,
    signInBtn: null,
    signUpBtn: null,
    anonBtn: null,
    signOutBtn: null,
    userEmail: null,
    userTier: null,
    manageKeysBtn: null,
    keyManagerModal: null,
    keyList: null,
    newKeyTier: null,
    newKeyDesc: null,
    createKeyBtn: null,
    closeKeyManager: null,
    clearHistoryBtn: null,
    totalConversions: null,
    totalSaved: null,
    avgSavings: null,
};

function initElements() {
    Object.keys(elements).forEach(key => {
        elements[key] = document.getElementById(key.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase()).replace(/^./, (m) => m.toLowerCase())) || 
                       document.getElementById(key) || null;
    });
}

// ============================================================
// API Client
// ============================================================

const API_BASE = '/api';

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<{ data: any; rateLimit: Record<string, string> }> {
    const token = await getIdToken(auth.currentUser!);
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`/api${endpoint}`, {
        ...options,
        headers,
        credentials: 'include',
    });

    const rateLimit: Record<string, string> = {};
    ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'].forEach(h => {
        const val = response.headers.get(h);
        if (val) rateLimit[h] = val;
    });

    if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
            const err = await response.json();
            detail = err.detail || detail;
        } catch {}
        throw new Error(detail);
    }

    const data = await response.json();
    return { data, rateLimit };
}

// ============================================================
// Authentication
// ============================================================

import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut as fbSignOut,
    onAuthStateChanged,
    signInAnonymously,
    updateProfile,
    sendPasswordResetEmail,
    User
} from 'firebase/auth';

let currentUser: any = null;
let currentTier: string = 'anonymous';

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
            currentTier = userDoc.data().tier || 'free';
        } else {
            currentTier = 'free';
        }
    } else {
        currentUser = null;
        currentTier = 'anonymous';
    }
    updateAuthUI();
    loadHistory();
    loadStats();
});

function updateAuthUI() {
    const user = auth.currentUser;
    // Update user menu visibility
    const authButtons = document.getElementById('authButtons');
    const userMenu = document.getElementById('userMenu');
    const anonBtn = document.getElementById('anonBtn');
    
    if (auth.currentUser) {
        authButtons?.classList.add('hidden');
        userMenu?.classList.remove('hidden');
        anonBtn?.classList.add('hidden');
        const userEmailEl = document.getElementById('userEmail');
        const userTierEl = document.getElementById('userTier');
        if (userEmailEl) userEmailEl.textContent = auth.currentUser.email || 'No email';
        if (userTierEl) userTierEl.textContent = `Tier: ${currentTier}`;
    } else {
        authButtons?.classList.remove('hidden');
        userMenu?.classList.add('hidden');
        anonBtn?.classList.remove('hidden');
    }
}

// ============================================================
// File Handling
// ============================================================

let selectedFiles: File[] = [];

function handleFiles(files: FileList) {
    for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
            alert(`${file.name} exceeds 10MB limit`);
            continue;
        }
        if (!selectedFiles.find(f => f.name === file.name)) {
            selectedFiles.push(file);
        }
    }
    updateFileList();
}

function removeFile(idx: number) {
    selectedFiles.splice(idx, 1);
    updateFileList();
}

function updateFileList() {
    const fileList = document.getElementById('fileList');
    const fileItems = document.getElementById('fileItems');
    const convertBtn = document.getElementById('convertBtn') as HTMLButtonElement;
    const clearBtn = document.getElementById('clearBtn');
    
    if (selectedFiles.length === 0) {
        fileList?.classList.add('hidden');
        convertBtn && (convertBtn.disabled = true);
        clearBtn?.classList.add('hidden');
        return;
    }
    
    fileList?.classList.remove('hidden');
    convertBtn && (convertBtn.disabled = false);
    clearBtn?.classList.remove('hidden');
    
    if (fileItems) {
        fileItems.innerHTML = selectedFiles.map((f, i) => `
            <div class="file-item">
                <span class="file-name">${f.name}</span>
                <span class="file-size">${formatSize(f.size)}</span>
                <button class="file-remove" onclick="removeFile(${i})">&#10005;</button>
            </div>
        `).join('');
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============================================================
// Progress Ring
// ============================================================

function updateProgress(percent: number, text: string) {
    const circle = document.getElementById('progressCircle');
    const percentEl = document.getElementById('progressPercent');
    const textEl = document.getElementById('progressText');
    
    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
    circle?.style.setProperty('stroke-dashoffset', String(offset));
    percentEl && (percentEl.textContent = Math.round(percent) + '%');
    textEl && (textEl.textContent = text);
}

function showLoading(show: boolean) {
    const loading = document.getElementById('loading');
    loading?.classList.toggle('hidden', !show);
    if (show) updateProgress(0, 'Starting...');
}

let startTime = 0;
let progressInterval: number | null = null;

function startProgressTimer(totalChars: number) {
    startTime = Date.now();
    const estimatedSeconds = Math.max(1, totalChars / 60000);
    
    progressInterval = window.setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const percent = Math.min(95, (elapsed / estimatedSeconds) * 100);
        const remaining = Math.max(0, estimatedSeconds - elapsed);
        updateProgress(percent, `Rendering... ~${Math.ceil(remaining)}s left`);
    }, 200);
}

function stopProgressTimer() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

// ============================================================
// Conversion Functions
// ============================================================

async function convertSingle(file: File) {
    if (!file) return;
    
    const mode = (document.getElementById('modeSelect') as HTMLSelectElement).value;
    const lineNumbers = (document.getElementById('lineNumbers') as HTMLInputElement).checked;
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);
    formData.append('line_numbers', lineNumbers.toString());
    
    showLoading(true);
    startProgressTimer(file.size);
    
    try {
        const res = await fetch('/api/convert', {
            method: 'POST',
            headers: await getAuthHeaders(),
            body: formData,
        });
        
        stopProgressTimer();
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Conversion failed');
        }
        
        const data = await res.json();
        updateProgress(100, `Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        
        setTimeout(() => {
            showLoading(false);
            showResults(data);
        }, 500);
    } catch (err: any) {
        stopProgressTimer();
        showLoading(false);
        alert('Error: ' + err.message);
    }
}

async function convertBatch() {
    const files = selectedFiles;
    if (files.length === 0) return;
    
    const mode = (document.getElementById('modeSelect') as HTMLSelectElement).value;
    const lineNumbers = (document.getElementById('lineNumbers') as HTMLInputElement).checked;
    
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('mode', mode);
    formData.append('line_numbers', lineNumbers.toString());
    
    showLoading(true);
    startProgressTimer(files.reduce((sum, f) => sum + f.size, 0));
    
    try {
        const res = await fetch(`/api/convert-batch?mode=${mode}&line_numbers=${lineNumbers}`, {
            method: 'POST',
            headers: await getAuthHeaders(),
            body: formData,
        });
        
        stopProgressTimer();
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Batch conversion failed');
        }
        
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tokensaver_batch_${new Date().toISOString().slice(0,10)}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        
        updateProgress(100, 'Download ready');
        setTimeout(() => { showLoading(false); alert('Batch ZIP downloaded!'); }, 500);
    } catch (err: any) {
        stopProgressTimer();
        showLoading(false);
        alert('Error: ' + err.message);
    }
}

// ============================================================
// Text Conversion
// ============================================================

const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
const convertTextBtn = document.getElementById('convertTextBtn') as HTMLButtonElement;
const charCountEl = document.getElementById('charCount');
const estimateBox = document.getElementById('estimateBox');
let estimateTimeout: number | null = null;

textInput?.addEventListener('input', () => {
    const len = textInput.value.length;
    charCountEl && (charCountEl.textContent = `${len.toLocaleString()} characters`);
    convertTextBtn && (convertTextBtn.disabled = len === 0);
    
    if (estimateTimeout) clearTimeout(estimateTimeout);
    if (len > 0) {
        estimateTimeout = window.setTimeout(() => getEstimate(textInput.value), 500);
    } else {
        estimateBox?.classList.add('hidden');
    }
});

async function getEstimate(text: string) {
    const mode = (document.getElementById('modeSelect') as HTMLSelectElement).value;
    
    try {
        const res = await fetch('/api/estimate', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                ...(await getAuthHeaders())
            },
            body: JSON.stringify({ text, mode }),
        });
        
        if (!res.ok) return;
        const data = await res.json();
        
        document.getElementById('estChars')!.textContent = data.chars.toLocaleString();
        document.getElementById('estTextTokens')!.textContent = formatTokenCount(data.text_tokens);
        document.getElementById('estImageTokens')!.textContent = formatTokenCount(data.estimated_image_tokens);
        document.getElementById('estSavings')!.textContent = data.estimated_savings_percent + '%';
        
        const worseEl = document.getElementById('estWorse');
        if (data.would_be_worse) {
            worseEl?.classList.remove('hidden');
            estimateBox?.classList.add('worse');
            estimateBox?.classList.remove('good');
            convertTextBtn && (convertTextBtn.disabled = true);
            convertTextBtn && (convertTextBtn.textContent = 'Image Costs More - Send as Text');
        } else {
            worseEl?.classList.add('hidden');
            estimateBox?.classList.remove('worse');
            estimateBox?.classList.add('good');
            convertTextBtn && (convertTextBtn.disabled = false);
            convertTextBtn && (convertTextBtn.textContent = 'Convert Text to PNG');
        }
        estimateBox?.classList.remove('hidden');
    } catch (e) {
        console.error('Estimate error:', e);
    }
}

async function convertText() {
    const text = textInput.value;
    if (!text.trim()) return;
    
    const mode = (document.getElementById('modeSelect') as HTMLSelectElement).value;
    const lineNumbers = (document.getElementById('lineNumbers') as HTMLInputElement).checked;
    
    showLoading(true);
    startProgressTimer(text.length);
    
    try {
        const res = await fetch(`/api/convert-text?mode=${mode}&line_numbers=${lineNumbers}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                ...(await getAuthHeaders())
            },
            body: JSON.stringify({ text, filename: 'pasted_text.txt' }),
        });
        
        stopProgressTimer();
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Conversion failed');
        }
        
        const data = await res.json();
        updateProgress(100, `Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        
        setTimeout(() => {
            showLoading(false);
            showResults(data);
        }, 500);
    } catch (err: any) {
        stopProgressTimer();
        showLoading(false);
        alert('Error: ' + err.message);
    }
}

// ============================================================
// Results Display
// ============================================================

function showResults(data: any) {
    document.getElementById('textTokens')!.textContent = data.stats.text_tokens_display;
    document.getElementById('imageTokens')!.textContent = data.stats.image_tokens_display;
    document.getElementById('savingsBadge')!.textContent = `${data.stats.savings_percent}% SAVED`;

    const recEl = document.getElementById('recommendation')!;
    if (data.stats.recommendation) {
        recEl.textContent = data.stats.recommendation;
        recEl.style.display = 'block';
    } else {
        recEl.style.display = 'none';
    }

    const preview = document.getElementById('pagePreview')!;
    preview.innerHTML = '<div class="page-grid">' +
        data.pages.map((p: any) => `
            <div class="page-card">
                <img src="${p.data}" alt="Page ${p.page}">
                <div class="info">
                    Page <span>${p.page}/${p.total_pages}</span> -
                    <span>${p.width}x${p.height}</span> -
                    <span>${p.tokens} tokens</span>
                </div>
            </div>
        `).join('') + '</div>';

    // Download all as ZIP
    const downloadBtn = document.getElementById('downloadAllBtn')!;
    downloadBtn.onclick = async () => {
        const JSZip = (window as any).JSZip;
        const zip = new JSZip();
        data.pages.forEach((p: any) => {
            const b64 = p.data.split(',')[1];
            zip.file(`${data.filename.replace(/\.[^.]+$/, '')}_p${p.page}.png`, b64, { base64: true });
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${data.filename.replace(/\.[^.]+$/, '')}.zip`;
        a.click();
    };

    document.getElementById('results')?.classList.remove('hidden');
    loadHistory();
}

// ============================================================
// History
// ============================================================

async function loadHistory() {
    try {
        const res = await apiRequest<{ data: any }>('/history?limit=20');
        const history = res.data.history;
        const tbody = document.getElementById('historyBody')!;
        
        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No conversions yet</td></tr>';
            return;
        }
        
        tbody.innerHTML = history.map((r: any) => `
            <tr>
                <td style="color:#f0f6fc;font-family:monospace;">${r.filename}</td>
                <td>${r.chars ? r.chars.toLocaleString() : '-'}</td>
                <td>${r.text_tokens}</td>
                <td>${r.image_tokens}</td>
                <td style="color:#3fb950;font-weight:bold;">${r.savings}</td>
                <td style="color:#8b949e;">${new Date(r.timestamp).toLocaleString()}</td>
                <td>
                    <div class="history-actions">
                        <button class="view-btn" onclick="viewHistoryItem('${r.id}')">View</button>
                        <button onclick="downloadHistoryItem('${r.id}')">Download</button>
                        <button class="copy-btn" onclick="copyHistoryItem('${r.id}')">Copy</button>
                        <button class="delete-btn" onclick="deleteHistoryItem('${r.id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('History load error:', e);
    }
}

async function loadStats() {
    try {
        const res = await apiRequest<{ data: any }>('/stats');
        const stats = res.data;
        document.getElementById('totalConversions')!.textContent = stats.total_conversions;
        document.getElementById('totalSaved')!.textContent = formatTokenCount(stats.total_text_tokens_saved);
        document.getElementById('avgSavings')!.textContent = stats.avg_savings_percent + '%';
    } catch (e) {
        console.error('Stats error:', e);
    }
}

// ============================================================
// Auth Modal
// ============================================================

function showAuthModal(mode: 'signin' | 'signup') {
    const authModal = document.getElementById('authModal');
    const authForm = document.getElementById('authForm');
    const authModalTitle = document.getElementById('authModalTitle');
    
    authForm.dataset.mode = mode;
    authModalTitle.textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
    
    authForm.innerHTML = `
        ${mode === 'signup' ? `
            <div class="form-group">
                <label>Display Name (optional)</label>
                <input type="text" name="displayName" autocomplete="name">
            </div>
        ` : ''}
        <div class="form-group">
            <label>Email</label>
            <input type="email" name="email" required autocomplete="email">
        </div>
        <div class="form-group">
            <label>Password</label>
            <input type="password" name="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}">
        </div>
        <button type="submit" class="btn btn-primary">${mode === 'signup' ? 'Create Account' : 'Sign In'}</button>
        <p class="auth-switch">
            ${mode === 'signup' 
                ? 'Already have an account? <a href="#" data-mode="signin">Sign In</a>'
                : 'Need an account? <a href="#" data-mode="signup">Sign Up</a> | <a href="#" data-mode="reset">Forgot Password?</a>'
            }
        </p>
    `;
    
    document.getElementById('authModal')?.classList.remove('hidden');
}

function closeAuthModal() {
    document.getElementById('authModal')?.classList.add('hidden');
}

// ============================================================
// Initialize
// ============================================================

function bindEvents() {
    // File upload
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    
    dropZone?.addEventListener('click', () => fileInput.click());
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer!.files);
    });
    fileInput?.addEventListener('change', (e) => handleFiles((e.target as HTMLInputElement).files!));
    
    document.getElementById('clearBtn')?.addEventListener('click', () => {
        selectedFiles = [];
        updateFileList();
        document.getElementById('results')?.classList.add('hidden');
    });
    
    document.getElementById('convertBtn')?.addEventListener('click', () => {
        if (selectedFiles.length === 1) convertSingle(selectedFiles[0]);
        else if (selectedFiles.length > 1) convertBatch();
    });
    
    // Text input
    const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
    const convertTextBtn = document.getElementById('convertTextBtn') as HTMLButtonElement;
    const charCountEl = document.getElementById('charCount');
    const estimateBox = document.getElementById('estimateBox');
    
    textInput?.addEventListener('input', () => {
        const len = textInput.value.length;
        charCountEl && (charCountEl.textContent = `${len.toLocaleString()} characters`);
        convertTextBtn && (convertTextBtn.disabled = len === 0);
        
        if (estimateTimeout) clearTimeout(estimateTimeout);
        if (len > 0) {
            estimateTimeout = window.setTimeout(() => getEstimate(textInput.value), 500);
        } else {
            estimateBox?.classList.add('hidden');
        }
    });
    
    convertTextBtn?.addEventListener('click', convertText);
    
    // Auth buttons
    document.getElementById('signInBtn')?.addEventListener('click', () => showAuthModal('signin'));
    document.getElementById('signUpBtn')?.addEventListener('click', () => showAuthModal('signup'));
    document.getElementById('anonBtn')?.addEventListener('click', () => signInAnonymously(auth));
    document.getElementById('signOutBtn')?.addEventListener('click', () => signOut(auth));
    
    // Auth modal
    document.getElementById('authModalClose')?.addEventListener('click', closeAuthModal);
    document.getElementById('authModal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAuthModal(); });
    
    document.getElementById('authForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const formData = new FormData(form);
        const mode = form.dataset.mode || 'signin';
        const email = formData.get('email') as string;
        const password = formData.get('password') as string;
        const displayName = formData.get('displayName') as string;
        
        const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Processing...';
        
        try {
            if (mode === 'signup') {
                const cred = await createUserWithEmailAndPassword(auth, email, password);
                if (displayName && cred.user) await updateProfile(cred.user, { displayName });
            } else if (mode === 'signin') {
                await signInWithEmailAndPassword(auth, email, password);
            }
            closeAuthModal();
        } catch (err: any) {
            const msgs: Record<string, string> = {
                'auth/email-already-in-use': 'Email already registered.',
                'auth/invalid-email': 'Invalid email.',
                'auth/weak-password': 'Password too weak (min 6 chars).',
                'auth/user-not-found': 'No account found.',
                'auth/wrong-password': 'Wrong password.',
            };
            alert(msgs[err.code] || err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    });
    
    // Auth mode switching
    document.getElementById('authForm')?.addEventListener('click', (e) => {
        const link = e.target as HTMLAnchorElement;
        if (link.matches('.auth-switch a')) {
            e.preventDefault();
            document.getElementById('authForm')!.dataset.mode = link.dataset.mode || 'signin';
            showAuthModal(link.dataset.mode as 'signin' | 'signup');
        }
    });
    
    // Clear history
    document.getElementById('clearHistoryBtn')?.addEventListener('click', async () => {
        if (!confirm('Clear all history?')) return;
        alert('Clear history coming soon');
    });
    
    // Image modal
    document.getElementById('modalClose')?.addEventListener('click', () => document.getElementById('imageModal')?.classList.add('hidden'));
    document.getElementById('imageModal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) document.getElementById('imageModal')?.classList.add('hidden'); });
    
    // Mode select change - re-estimate
    document.getElementById('modeSelect')?.addEventListener('change', () => {
        const text = (document.getElementById('textInput') as HTMLTextAreaElement).value;
        if (text) getEstimate(text);
    });
}

// ============================================================
// Auth Headers Helper
// ============================================================

async function getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken(auth.currentUser!);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

// ============================================================
// Format Token Count
// ============================================================

function formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(1) + 'M';
    if (tokens >= 1_000) return (tokens / 1_000).toFixed(1) + 'K';
    return tokens.toString();
}

// ============================================================
// Global Functions (for onclick handlers)
// ============================================================

(window as any).removeFile = removeFile;
(window as any).showAuthModal = showAuthModal;
(window as any).viewHistoryItem = (id: string) => alert('View: ' + id);
(window as any).downloadHistoryItem = (id: string) => alert('Download: ' + id);
(window as any).copyHistoryItem = (id: string) => alert('Copy: ' + id);
(window as any).deleteHistoryItem = (id: string) => alert('Delete: ' + id);

// ============================================================
// Start
// ============================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initElements();
        bindEvents();
    });
} else {
    initElements();
    bindEvents();
}