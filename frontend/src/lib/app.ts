// TokenSaver Frontend Application
import { auth, db } from './lib/firebase';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signInAnonymously, 
    signOut, 
    sendPasswordResetEmail,
    onAuthStateChanged,
    User
} from 'firebase/auth';
import { 
    doc, 
    collection, 
    getDoc, 
    setDoc, 
    updateDoc, 
    increment,
    arrayUnion,
    serverTimestamp,
    query,
    orderBy,
    limit,
    onSnapshot,
    Timestamp
} from 'firebase/firestore';

// ============================================================
// API Client
// ============================================================

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

interface RateLimitInfo {
    limit?: string;
    remaining?: string;
    reset?: string;
    retryAfter?: string;
}

interface ApiResponse<T> {
    data: T;
    rateLimit: RateLimitInfo;
}

class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public rateLimit: RateLimitInfo = {}
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

async function getAuthHeaders(): Promise<HeadersInit> {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const user = auth.currentUser;
    if (user) {
        try {
            const token = await user.getIdToken(true);
            headers['Authorization'] = `Bearer ${token}`;
        } catch (e) {
            console.warn('Failed to get ID token:', e);
        }
    }
    return headers;
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: { ...headers, ...options.headers },
        credentials: 'include',
    });

    const rateLimit: RateLimitInfo = {};
    ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'].forEach(h => {
        const val = response.headers.get(h);
        if (val) rateLimit[h.replace('x-ratelimit-', '')] = val;
    });

    if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
            const data = await response.json();
            detail = data.detail || detail;
        } catch {}
        throw new ApiError(response.status, detail, rateLimit);
    }

    const data = await response.json();
    return { data, rateLimit };
}

// ============================================================
// State Management
// ============================================================

let currentUser: User | null = null;
let currentTier = 'anonymous';
let selectedFiles: File[] = [];
let estimateTimeout: number | null = null;

const CIRCUMFERENCE = 2 * Math.PI * 54;

// ============================================================
// DOM Elements (initialized in init)
// ============================================================

let elements: Record<string, HTMLElement> = {};

function $(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return el;
}

function initElements() {
    elements = {
        dropZone: $('dropZone'),
        fileInput: $('fileInput'),
        fileList: $('fileList'),
        fileItems: $('fileItems'),
        convertBtn: $('convertBtn'),
        clearBtn: $('clearBtn'),
        loading: $('loading'),
        results: $('results'),
        textInput: $('textInput'),
        convertTextBtn: $('convertTextBtn'),
        charCount: $('charCount'),
        estimateBox: $('estimateBox'),
        modeSelect: $('modeSelect'),
        lineNumbers: $('lineNumbers'),
        downloadAllBtn: $('downloadAllBtn'),
        historyBody: $('historyBody'),
        clearHistoryBtn: $('clearHistoryBtn'),
        imageModal: $('imageModal'),
        modalTitle: $('modalTitle'),
        modalImage: $('modalImage'),
        modalDownload: $('modalDownload'),
        modalCopy: $('modalCopy'),
        modalClose: $('modalClose'),
        // Auth
        signInBtn: $('signInBtn'),
        signUpBtn: $('signUpBtn'),
        anonBtn: $('anonBtn'),
        userMenu: $('userMenu'),
        userEmail: $('userEmail'),
        userTier: $('userTier'),
        signOutBtn: $('signOutBtn'),
        manageKeysBtn: $('manageKeysBtn'),
        authModal: $('authModal'),
        authForm: $('authForm'),
        authModalTitle: $('authModalTitle'),
        authModalClose: $('authModalClose'),
        // Key management
        keyManagerModal: $('keyManagerModal'),
        keyList: $('keyList'),
        newKeyBtn: $('newKeyBtn'),
        newKeyTier: $('newKeyTier'),
        newKeyDesc: $('newKeyDesc'),
        createKeyBtn: $('createKeyBtn'),
        closeKeyManager: $('closeKeyManager'),
    };
}

// ============================================================
// Progress Ring
// ============================================================

function updateProgress(percent: number, text: string) {
    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
    const circle = document.getElementById('progressCircle');
    const textEl = document.getElementById('progressPercent');
    const subText = document.getElementById('progressText');
    if (circle) circle.style.strokeDashoffset = String(offset);
    if (textEl) textEl.textContent = `${Math.round(percent)}%`;
    if (subText) subText.textContent = text;
}

function showLoading(show: boolean) {
    elements.loading?.classList.toggle('hidden', !show);
    elements.results?.classList.add('hidden');
    if (show) updateProgress(0, 'Starting conversion...');
}

// ============================================================
// File Handling
// ============================================================

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateFileList() {
    if (selectedFiles.length === 0) {
        elements.fileList?.classList.add('hidden');
        elements.convertBtn && (elements.convertBtn.disabled = true);
        elements.clearBtn?.classList.add('hidden');
        return;
    }
    elements.fileList?.classList.remove('hidden');
    elements.convertBtn && (elements.convertBtn.disabled = false);
    elements.clearBtn?.classList.remove('hidden');
    elements.fileItems!.innerHTML = selectedFiles.map((f, i) => `
        <div class="file-item">
            <span class="file-name">${f.name}</span>
            <span class="file-size">${formatSize(f.size)}</span>
            <button class="file-remove" onclick="removeFile(${i})">&#10005;</button>
        </div>
    `).join('');
}

function handleFiles(files: FileList) {
    for (const file of files) {
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

function removeFile(index: number) {
    selectedFiles.splice(index, 1);
    updateFileList();
}

// ============================================================
// Estimate (Real-time)
// ============================================================

async function getEstimate(text: string) {
    const mode = elements.modeSelect?.value || 'standard';
    try {
        const res = await apiRequest<{ data: any }>('/estimate', {
            method: 'POST',
            body: JSON.stringify({ text, mode }),
        });
        const data = res.data;
        
        const charsEl = document.getElementById('estChars');
        const textTokensEl = document.getElementById('estTextTokens');
        const imageTokensEl = document.getElementById('estImageTokens');
        const savingsEl = document.getElementById('estSavings');
        const worseEl = document.getElementById('estWorse');
        
        charsEl && (charsEl.textContent = data.chars.toLocaleString());
        textTokensEl && (textTokensEl.textContent = formatTokenCount(data.text_tokens));
        imageTokensEl && (imageTokensEl.textContent = formatTokenCount(data.estimated_image_tokens));
        savingsEl && (savingsEl.textContent = `${data.estimated_savings_percent}%`);
        
        if (data.would_be_worse) {
            worseEl?.classList.remove('hidden');
            elements.estimateBox?.classList.add('worse');
            elements.estimateBox?.classList.remove('good');
            elements.convertTextBtn && (elements.convertTextBtn.disabled = true);
            elements.convertTextBtn && (elements.convertTextBtn.textContent = 'Image Costs More - Send as Text');
        } else {
            worseEl?.classList.add('hidden');
            elements.estimateBox?.classList.remove('worse');
            elements.estimateBox?.classList.add('good');
            elements.convertTextBtn && (elements.convertTextBtn.disabled = false);
            elements.convertTextBtn && (elements.convertTextBtn.textContent = 'Convert Text to PNG');
        }
        elements.estimateBox?.style.display = 'block';
    } catch (e) {
        console.error('Estimate error:', e);
    }
}

function formatTokenCount(tokens: number): string {
    if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
    if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
    return tokens.toString();
}

// ============================================================
// Conversion
// ============================================================

async function convertSingle(file: File) {
    const startTime = Date.now();
    showLoading(true);
    elements.results?.classList.add('hidden');
    elements.convertBtn && (elements.convertBtn.disabled = true);

    try {
        const mode = elements.modeSelect?.value || 'standard';
        const lineNumbers = elements.lineNumbers?.checked || false;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', mode);
        formData.append('line_numbers', lineNumbers.toString());

        const res = await apiRequest<{ data: any }>('/convert', {
            method: 'POST',
            body: formData,
            headers: {}, // Let browser set Content-Type
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        updateProgress(100, `Done in ${elapsed}s`);
        setTimeout(() => {
            showLoading(false);
            showResults(res.data);
        }, 500);
    } catch (err: any) {
        showLoading(false);
        alert('Error: ' + err.message);
    } finally {
        elements.convertBtn && (elements.convertBtn.disabled = false);
    }
}

async function convertText() {
    const text = elements.textInput?.value;
    if (!text?.trim()) return;

    const startTime = Date.now();
    showLoading(true);
    elements.results?.classList.add('hidden');
    elements.convertTextBtn && (elements.convertTextBtn.disabled = true);

    try {
        const mode = elements.modeSelect?.value || 'standard';
        const lineNumbers = elements.lineNumbers?.checked || false;

        const res = await apiRequest<{ data: any }>('/convert-text', {
            method: 'POST',
            body: JSON.stringify({ text, filename: 'pasted_text.txt', mode, line_numbers: lineNumbers }),
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        updateProgress(100, `Done in ${elapsed}s`);
        setTimeout(() => {
            showLoading(false);
            showResults(res.data);
        }, 500);
    } catch (err: any) {
        showLoading(false);
        alert('Error: ' + err.message);
    } finally {
        elements.convertTextBtn && (elements.convertTextBtn.disabled = false);
    }
}

async function convertBatch() {
    const startTime = Date.now();
    showLoading(true);
    elements.results?.classList.add('hidden');
    elements.convertBtn && (elements.convertBtn.disabled = true);

    try {
        const mode = elements.modeSelect?.value || 'standard';
        const lineNumbers = elements.lineNumbers?.checked || false;

        const formData = new FormData();
        selectedFiles.forEach(f => formData.append('files', f));
        formData.append('mode', mode);
        formData.append('line_numbers', lineNumbers.toString());

        const res = await apiRequest<Blob>('/convert-batch', {
            method: 'POST',
            body: formData,
            headers: {},
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        updateProgress(100, `Done in ${elapsed}s`);

        const blob = new Blob([res.data as unknown as BlobPart], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tokensaver_batch_${new Date().toISOString().slice(0,10)}.zip`;
        a.click();
        URL.revokeObjectURL(url);

        setTimeout(() => { showLoading(false); alert('Batch ZIP downloaded!'); }, 500);
    } catch (err: any) {
        showLoading(false);
        alert('Error: ' + err.message);
    } finally {
        elements.convertBtn && (elements.convertBtn.disabled = false);
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
    document.getElementById('downloadAllBtn')!.onclick = async () => {
        const zip = new (window as any).JSZip();
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

    elements.results?.classList.remove('hidden');
    loadHistory();
}

// ============================================================
// History (Firestore)
// ============================================================

async function loadHistory() {
    try {
        // For now, use the server API which uses Firestore
        const res = await apiRequest<{ data: any }>('/history?limit=20');
        const history = res.data.history;
        
        const tbody = elements.historyBody!;
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
// Auth UI
// ============================================================

function updateAuthUI(user: User | null) {
    currentUser = user;
    
    const authButtons = document.getElementById('authButtons');
    const userMenu = elements.userMenu;
    const signInBtn = elements.signInBtn;
    const signUpBtn = elements.signUpBtn;
    const anonBtn = elements.anonBtn;
    
    if (user) {
        // Signed in
        authButtons?.classList.add('hidden');
        userMenu?.classList.remove('hidden');
        elements.userEmail!.textContent = user.email || 'No email';
        elements.userTier!.textContent = `Tier: ${currentTier}`;
        
        // Update key manager if open
        refreshKeyList();
    } else {
        // Signed out
        authButtons?.classList.remove('hidden');
        userMenu?.classList.add('hidden');
        elements.anonBtn?.classList.remove('hidden');
    }
}

async function refreshUserTier() {
    if (!currentUser) { currentTier = 'anonymous'; return; }
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            currentTier = userDoc.data().tier || 'free';
        } else {
            currentTier = 'free';
        }
        elements.userTier && (elements.userTier!.textContent = `Tier: ${currentTier}`);
    } catch (e) {
        console.error('Failed to fetch tier:', e);
        currentTier = 'free';
    }
}

// ============================================================
// API Key Management
// ============================================================

function showKeyManagerModal() {
    elements.keyManagerModal?.classList.remove('hidden');
    refreshKeyList();
}

function closeKeyManager() {
    elements.keyManagerModal?.classList.add('hidden');
}

async function refreshKeyList() {
    if (!currentUser) return;
    
    try {
        const keysRef = collection(db, 'api_keys');
        const q = query(keysRef, orderBy('created_at', 'desc'));
        const snapshot = await getDocs(q);
        
        const userKeys = snapshot.docs
            .filter(d => d.data().uid === currentUser!.uid)
            .map(d => ({ id: d.id, ...d.data() }));
        
        elements.keyList!.innerHTML = userKeys.map(k => `
            <div class="key-item">
                <div class="key-info">
                    <span class="key-prefix">${k.prefix}...</span>
                    <span class="key-tier">${k.tier}</span>
                    <span class="key-usage">${k.total_requests || 0} requests</span>
                    <span class="key-desc">${k.description || ''}</span>
                </div>
                <div class="key-actions">
                    <button class="btn btn-secondary btn-sm" onclick="copyKey('${k.id}')">Copy</button>
                    <button class="btn btn-danger btn-sm" onclick="revokeKey('${k.id}')">Revoke</button>
                </div>
            </div>
        `).join('') || '<p class="empty">No API keys yet</p>';
    } catch (e) {
        console.error('Key list error:', e);
    }
}

async function createNewKey() {
    const tier = elements.newKeyTier?.value || 'free';
    const desc = elements.newKeyDesc?.value || '';
    
    try {
        const res = await apiRequest<{ data: any }>('/keys/generate', {
            method: 'POST',
            body: JSON.stringify({ tier, description: desc }),
        });
        alert(`API Key: ${res.data.api_key}\n\nStore this securely - it won't be shown again!`);
        elements.newKeyDesc && (elements.newKeyDesc!.value = '');
        refreshKeyList();
    } catch (e: any) {
        alert('Error: ' + e.message);
    }
}

async function revokeKey(keyHash: string) {
    if (!confirm('Revoke this API key?')) return;
    try {
        await apiRequest<{ data: any }>(`/keys/revoke?api_key=${keyHash}`, { method: 'POST' });
        refreshKeyList();
    } catch (e: any) {
        alert('Error: ' + e.message);
    }
}

async function copyKey(keyHash: string) {
    try {
        await navigator.clipboard.writeText(keyHash);
        alert('Key ID copied to clipboard');
    } catch (e) {
        alert('Failed to copy');
    }
}

// ============================================================
// History Actions (modal)
// ============================================================

let currentModalRecord: any = null;

function viewHistoryItem(id: string) {
    // We need to fetch the full record - for now open with first page
    alert('View feature coming soon');
}

async function downloadHistoryItem(id: string) {
    try {
        const res = await apiRequest<{ data: any }>(`/history/${id}/download`);
        // Implementation depends on backend
        alert('Download feature coming soon');
    } catch (e) {
        alert('Error downloading');
    }
}

async function copyHistoryItem(id: string) {
    try {
        // Copy the first page base64
        alert('Copy feature coming soon');
    } catch (e) {
        alert('Error copying');
    }
}

async function deleteHistoryItem(id: string) {
    if (!confirm('Delete this history item?')) return;
    try {
        // Need backend endpoint
        alert('Delete feature coming soon');
        loadHistory();
    } catch (e) {
        alert('Error deleting');
    }
}

// ============================================================
// Event Listeners
// ============================================================

function bindEvents() {
    // File upload
    elements.dropZone?.addEventListener('click', () => elements.fileInput?.click());
    elements.dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); elements.dropZone?.classList.add('dragover'); });
    elements.dropZone?.addEventListener('dragleave', () => elements.dropZone?.classList.remove('dragover'));
    elements.dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.dropZone?.classList.remove('dragover');
        handleFiles(e.dataTransfer!.files);
    });
    elements.fileInput?.addEventListener('change', (e) => handleFiles((e.target as HTMLInputElement).files!));

    // Clear files
    elements.clearBtn?.addEventListener('click', () => {
        selectedFiles = [];
        updateFileList();
        elements.results?.classList.add('hidden');
    });

    // Convert buttons
    elements.convertBtn?.addEventListener('click', () => {
        if (selectedFiles.length === 1) convertSingle(selectedFiles[0]);
        else if (selectedFiles.length > 1) convertBatch();
    });

    // Text input
    elements.textInput?.addEventListener('input', () => {
        const len = elements.textInput!.value.length;
        elements.charCount!.textContent = `${len.toLocaleString()} characters`;
        elements.convertTextBtn && (elements.convertTextBtn.disabled = len === 0);
        
        if (estimateTimeout) clearTimeout(estimateTimeout);
        if (len > 0) {
            estimateTimeout = window.setTimeout(() => getEstimate(elements.textInput!.value), 500);
        } else {
            elements.estimateBox?.style.display = 'none';
        }
    });

    elements.convertTextBtn?.addEventListener('click', convertText);

    // Auth buttons
    elements.signInBtn?.addEventListener('click', () => showAuthModal('signin'));
    elements.signUpBtn?.addEventListener('click', () => showAuthModal('signup'));
    elements.anonBtn?.addEventListener('click', () => signInAnonymously(auth));
    elements.signOutBtn?.addEventListener('click', () => signOut(auth));
    
    // Auth modal
    elements.authModalClose?.addEventListener('click', () => elements.authModal?.classList.add('hidden'));
    elements.authModal?.addEventListener('click', (e) => { if (e.target === elements.authModal) elements.authModal?.classList.add('hidden'); });
    
    // Auth form submit
    elements.authForm?.addEventListener('submit', async (e) => {
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
                if (displayName && cred.user) await cred.user.updateProfile({ displayName });
            } else if (mode === 'signin') {
                await signInWithEmailAndPassword(auth, email, password);
            }
            elements.authModal?.classList.add('hidden');
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
    elements.authForm?.addEventListener('click', (e) => {
        const link = e.target as HTMLAnchorElement;
        if (link.matches('.auth-switch a')) {
            e.preventDefault();
            elements.authForm!.dataset.mode = link.dataset.mode || 'signin';
            showAuthModal(elements.authForm!.dataset.mode as 'signin' | 'signup');
        }
    });

    // Key management
    elements.manageKeysBtn?.addEventListener('click', showKeyManagerModal);
    elements.closeKeyManager?.addEventListener('click', closeKeyManager);
    elements.createKeyBtn?.addEventListener('click', createNewKey);

    // History
    elements.clearHistoryBtn?.addEventListener('click', async () => {
        if (!confirm('Clear all history?')) return;
        // Need backend endpoint
        alert('Clear history coming soon');
    });

    // Image modal
    elements.modalClose?.addEventListener('click', () => elements.imageModal?.classList.add('hidden'));
    elements.imageModal?.addEventListener('click', (e) => { if (e.target === elements.imageModal) elements.imageModal?.classList.add('hidden'); });
}

// ============================================================
// Auth Modal
// ============================================================

function showAuthModal(mode: 'signin' | 'signup') {
    elements.authForm!.dataset.mode = mode;
    elements.authModalTitle!.textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
    elements.authForm!.innerHTML = `
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
    elements.authModal?.classList.remove('hidden');
}

// ============================================================
// Initialize
// ============================================================

async function init() {
    initElements();
    bindEvents();
    
    // Listen for auth state changes
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (user) {
            await refreshUserTier();
        } else {
            currentTier = 'anonymous';
        }
        updateAuthUI(user);
        loadHistory();
        loadStats();
    });
    
    // Initial history load
    loadHistory();
    loadStats();
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Make functions globally available for onclick handlers
(window as any).removeFile = removeFile;
(window as any).viewHistoryItem = viewHistoryItem;
(window as any).downloadHistoryItem = downloadHistoryItem;
(window as any).copyHistoryItem = copyHistoryItem;
(window as any).deleteHistoryItem = deleteHistoryItem;
(window as any).showAuthModal = showAuthModal;