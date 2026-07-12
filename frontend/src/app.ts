// Main Application Logic
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut as fbSignOut,
    onAuthStateChanged,
    signInAnonymously,
    sendPasswordResetEmail,
    updateProfile,
    User
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
    where,
    Timestamp
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { api, parseResponse } from './lib/api';

// ============================================================
// Global State
// ============================================================

let currentUser: User | null = null;
let currentTier = 'anonymous';
let selectedFiles: File[] = [];
let estimateTimeout: number | null = null;
let startTime = 0;
let progressInterval: number | null = null;

const CIRCUMFERENCE = 2 * Math.PI * 54;

// ============================================================
// DOM Helpers
// ============================================================

function $(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return el;
}

function formatTokenCount(tokens: number): string {
    if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
    if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
    return tokens.toString();
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============================================================
// Auth State
// ============================================================

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
            currentTier = userDoc.data().tier || 'free';
        } else {
            currentTier = 'free';
            await setDoc(doc(db, 'users', user.uid), {
                email: user.email,
                displayName: user.displayName || user.email?.split('@')[0],
                tier: 'free',
                createdAt: Timestamp.now(),
                emailVerified: user.emailVerified,
            });
        }
    } else {
        currentTier = 'anonymous';
    }
    updateAuthUI();
    loadHistory();
    loadStats();
});

function updateAuthUI() {
    const user = auth.currentUser;
    const authButtons = document.getElementById('authButtons');
    const userMenu = document.getElementById('userMenu');
    const anonBtn = document.getElementById('anonBtn');
    
    if (user) {
        authButtons?.classList.add('hidden');
        userMenu?.classList.remove('hidden');
        anonBtn?.classList.add('hidden');
        const userEmail = document.getElementById('userEmail');
        const userTier = document.getElementById('userTier');
        if (userEmail) userEmail.textContent = user.email || 'No email';
        if (userTier) userTier.textContent = `Tier: ${currentTier}`;
    } else {
        authButtons?.classList.remove('hidden');
        userMenu?.classList.add('hidden');
        anonBtn?.classList.remove('hidden');
    }
}

// ============================================================
// Progress Ring
// ============================================================

function updateProgress(percent: number, text: string) {
    const circle = document.getElementById('progressCircle');
    const percentEl = document.getElementById('progressPercent');
    const subText = document.getElementById('progressText');
    
    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
    circle?.style.setProperty('stroke-dashoffset', String(offset));
    percentEl && (percentEl.textContent = Math.round(percent) + '%');
    subText && (subText.textContent = text);
}

function showLoading(show: boolean) {
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');
    loading?.classList.toggle('hidden', !show);
    if (show) {
        results?.classList.add('hidden');
        updateProgress(0, 'Starting...');
    }
}

// ============================================================
// File Handling
// ============================================================

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
// Estimate (Real-time)
// ============================================================

async function getEstimate(text: string) {
    const mode = (document.getElementById('modeSelect') as HTMLSelectElement).value;
    const estimateBox = document.getElementById('estimateBox');
    const estWorse = document.getElementById('estWorse');
    const convertTextBtn = document.getElementById('convertTextBtn') as HTMLButtonElement;
    
    try {
        const res = await api.estimate(text, mode);
        const data = await parseResponse(res);
        
        document.getElementById('estChars')!.textContent = data.chars.toLocaleString();
        document.getElementById('estTextTokens')!.textContent = formatTokenCount(data.text_tokens);
        document.getElementById('estImageTokens')!.textContent = formatTokenCount(data.estimated_image_tokens);
        document.getElementById('estSavings')!.textContent = data.estimated_savings_percent + '%';
        
        if (data.would_be_worse) {
            estWorse?.classList.remove('hidden');
            estimateBox?.classList.add('worse');
            estimateBox?.classList.remove('good');
            convertTextBtn && (convertTextBtn.disabled = true);
            convertTextBtn && (convertTextBtn.textContent = 'Image Costs More - Send as Text');
        } else {
            estWorse?.classList.add('hidden');
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

function formatTokenCount(tokens: number): string {
    if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
    if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
    return tokens.toString();
}

// ============================================================
// Progress Ring
// ============================================================

function updateProgress(percent: number, text: string) {
    const circle = document.getElementById('progressCircle');
    const percentEl = document.getElementById('progressPercent');
    const subText = document.getElementById('progressText');
    
    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
    circle?.style.setProperty('stroke-dashoffset', String(offset));
    percentEl && (percentEl.textContent = Math.round(percent) + '%');
    subText && (subText.textContent = text);
}

function showLoading(show: boolean) {
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');
    loading?.classList.toggle('hidden', !show);
    if (show) {
        results?.classList.add('hidden');
        updateProgress(0, 'Starting...');
    }
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
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Conversion failed');
        }
        
        const data = await res.json();
        stopProgressTimer();
        updateProgress(100, `Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        
        setTimeout(() => {
            showLoading(false);
            showResults(data);
        }, 500);
    } catch (err: any) {
        showLoading(false);
        stopProgressTimer();
        alert('Error: ' + err.message);
    }
}

async function convertBatch() {
    if (selectedFiles.length === 0) return;
    
    const mode = (document.getElementById('modeSelect') as HTMLSelectElement).value;
    const lineNumbers = (document.getElementById('lineNumbers') as HTMLInputElement).checked;
    
    const formData = new FormData();
    selectedFiles.forEach(f => formData.append('files', f));
    formData.append('mode', mode);
    formData.append('line_numbers', lineNumbers.toString());
    
    showLoading(true);
    startProgressTimer(selectedFiles.reduce((sum, f) => sum + f.size, 0));
    
    try {
        const res = await fetch(`/api/convert-batch?mode=${mode}&line_numbers=${lineNumbers}`, {
            method: 'POST',
            headers: await getAuthHeaders(),
            body: formData,
        });
        
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
        
        showLoading(false);
        stopProgressTimer();
        alert('Batch ZIP downloaded!');
    } catch (err: any) {
        showLoading(false);
        stopProgressTimer();
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

textInput?.addEventListener('input', () => {
    const len = textInput.value.length;
    document.getElementById('charCount')!.textContent = `${len.toLocaleString()} characters`;
    convertTextBtn && (convertTextBtn.disabled = len === 0);
    
    if (estimateTimeout) clearTimeout(estimateTimeout);
    if (len > 0) {
        estimateTimeout = window.setTimeout(() => getEstimate(textInput.value), 500);
    } else {
        document.getElementById('estimateBox')?.classList.add('hidden');
    }
});

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
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Conversion failed');
        }
        
        const data = await res.json();
        stopProgressTimer();
        updateProgress(100, `Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        
        setTimeout(() => {
            showLoading(false);
            showResults(data);
        }, 500);
    } catch (err: any) {
        showLoading(false);
        stopProgressTimer();
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
    document.getElementById('downloadAllBtn')!.onclick = async () => {
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
        const res = await api.history(20);
        const data = await parseResponse(res);
        const tbody = document.getElementById('historyBody')!;
        
        if (data.history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No conversions yet</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.history.map((r: any) => `
            <tr>
                <td style="color:#f0f6fc;font-family:monospace;">${r.filename}</td>
                <td>${r.chars ? r.chars.toLocaleString() : '-'}</td>
                <td>${r.text_tokens}</td>
                <td>${r.image_tokens}</td>
                <td style="color:#3fb950;font-weight:bold;">${r.savings}</td>
                <td style="color:#8b949e;">${new Date(r.timestamp).toLocaleString()}</td>
                <td>
                    <div class="history-actions">
                        <button class="view-btn" onclick="viewHistory('${r.id}')">View</button>
                        <button onclick="downloadHistory('${r.id}')">Download</button>
                        <button class="copy-btn" onclick="copyHistory('${r.id}')">Copy</button>
                        <button class="delete-btn" onclick="deleteHistory('${r.id}')">Delete</button>
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
        const res = await api.stats();
        const stats = await parseResponse(res);
        document.getElementById('totalConversions')!.textContent = stats.total_conversions;
        document.getElementById('totalSaved')!.textContent = formatTokenCount(stats.total_text_tokens_saved);
        document.getElementById('avgSavings')!.textContent = stats.avg_savings_percent + '%';
    } catch (e) {}
}

// ============================================================
// Event Handlers
// ============================================================

function bindEvents() {
    // File upload
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone?.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer!.files); });
    fileInput?.addEventListener('change', (e) => handleFiles((e.target as HTMLInputElement).files!));

    // Clear files
    document.getElementById('clearBtn')?.addEventListener('click', () => {
        selectedFiles = [];
        updateFileList();
        document.getElementById('results')?.classList.add('hidden');
    });

    // Convert buttons
    document.getElementById('convertBtn')?.addEventListener('click', () => {
        if (selectedFiles.length === 1) convertSingle(selectedFiles[0]);
        else if (selectedFiles.length > 1) convertBatch();
    });

    // Text input
    const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
    const convertTextBtn = document.getElementById('convertTextBtn');
    const charCount = document.getElementById('charCount');
    const estimateBox = document.getElementById('estimateBox');
    let estimateTimeout: number | null = null;
    
    textInput?.addEventListener('input', () => {
        const len = textInput.value.length;
        document.getElementById('charCount')!.textContent = `${len.toLocaleString()} characters`;
        document.getElementById('convertTextBtn')!.disabled = len === 0;
        
        if (estimateTimeout) clearTimeout(estimateTimeout);
        if (len > 0) {
            estimateTimeout = window.setTimeout(() => getEstimate(textInput.value), 500);
        } else {
            document.getElementById('estimateBox')?.classList.add('hidden');
        }
    });

    document.getElementById('convertTextBtn')?.addEventListener('click', convertText);

    // Auth
    document.getElementById('signInBtn')?.addEventListener('click', () => showAuthModal('signin'));
    document.getElementById('signUpBtn')?.addEventListener('click', () => showAuthModal('signup'));
    document.getElementById('anonBtn')?.addEventListener('click', () => signInAnonymously(auth));
    document.getElementById('signOutBtn')?.addEventListener('click', () => fbSignOut(auth));
    
    // Auth modal
    const authForm = document.getElementById('authForm');
    const authModal = document.getElementById('authModal');
    const authModalClose = document.getElementById('authModalClose');
    
    authModalClose?.addEventListener('click', () => authModal?.classList.add('hidden'));
    authModal?.addEventListener('click', (e) => { if (e.target === authModal) authModal.classList.add('hidden'); });
    
    authForm?.addEventListener('submit', async (e) => {
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
            document.getElementById('authModal')?.classList.add('hidden');
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
        const link = (e.target as HTMLAnchorElement).closest('.auth-switch a');
        if (link) {
            e.preventDefault();
            (document.getElementById('authForm') as HTMLFormElement).dataset.mode = link.dataset.mode || 'signin';
            showAuthModal((document.getElementById('authForm') as HTMLFormElement).dataset.mode as 'signin' | 'signup');
        }
    });

    document.getElementById('signInBtn')?.addEventListener('click', () => showAuthModal('signin'));
    document.getElementById('signUpBtn')?.addEventListener('click', () => showAuthModal('signup'));
    document.getElementById('anonBtn')?.addEventListener('click', () => signInAnonymously(auth));
    document.getElementById('signOutBtn')?.addEventListener('click', () => fbSignOut(auth));

    // Auth modal close
    document.getElementById('authModalClose')?.addEventListener('click', () => {
        document.getElementById('authModal')?.classList.add('hidden');
    });
    document.getElementById('authModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('authModal')) document.getElementById('authModal')?.classList.add('hidden');
    });

    // Convert buttons
    document.getElementById('convertBtn')?.addEventListener('click', () => {
        if (selectedFiles.length === 1) convertSingle(selectedFiles[0]);
        else if (selectedFiles.length > 1) convertBatch();
    });

    document.getElementById('convertTextBtn')?.addEventListener('click', convertText);

    // Text input
    const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
    const convertTextBtn = document.getElementById('convertTextBtn');
    let estimateTimeout: number | null = null;
    
    textInput?.addEventListener('input', () => {
        const len = textInput.value.length;
        document.getElementById('charCount')!.textContent = `${len.toLocaleString()} characters`;
        convertTextBtn && (convertTextBtn.disabled = len === 0);
        
        if (estimateTimeout) clearTimeout(estimateTimeout);
        if (len > 0) {
            estimateTimeout = window.setTimeout(() => getEstimate(textInput.value), 500);
        } else {
            document.getElementById('estimateBox')?.classList.add('hidden');
        }
    });

    // Clear files
    document.getElementById('clearBtn')?.addEventListener('click', () => {
        selectedFiles = [];
        updateFileList();
        document.getElementById('results')?.classList.add('hidden');
    });

    // Clear history
    document.getElementById('clearHistoryBtn')?.addEventListener('click', async () => {
        if (!confirm('Clear all history?')) return;
        // Need backend endpoint
        alert('Clear history coming soon');
    });

    // Image modal
    document.getElementById('modalClose')?.addEventListener('click', () => {
        document.getElementById('imageModal')?.classList.add('hidden');
    });
    document.getElementById('imageModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('imageModal')) document.getElementById('imageModal')?.classList.add('hidden');
    });

    // Auth modal close
    document.getElementById('authModalClose')?.addEventListener('click', () => {
        document.getElementById('authModal')?.classList.add('hidden');
    });
    document.getElementById('authModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('authModal')) document.getElementById('authModal')?.classList.add('hidden');
    });
}

// ============================================================
// Auth Modal
// ============================================================

function showAuthModal(mode: 'signin' | 'signup') {
    const authForm = document.getElementById('authForm') as HTMLFormElement;
    const authModalTitle = document.getElementById('authModalTitle');
    const authModal = document.getElementById('authModal');
    
    authForm.dataset.mode = mode;
    authModalTitle!.textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
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

// ============================================================
// Auth Headers Helper
// ============================================================

async function getAuthHeaders(): Promise<Record<string, string>> {
    const user = auth.currentUser;
    if (!user) return {};
    try {
        const token = await user.getIdToken(true);
        return { 'Authorization': `Bearer ${token}` };
    } catch (e) {
        console.warn('Failed to get ID token:', e);
        return {};
    }
}

// ============================================================
// Init
// ============================================================

function init() {
    bindEvents();
    loadHistory();
    loadStats();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Make functions globally available for onclick handlers
(window as any).removeFile = removeFile;
(window as any).showAuthModal = showAuthModal;