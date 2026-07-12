// TokenSaver v2.1 - Main Application
import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase config - uses env vars in production
const firebaseConfig = {
    apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY || "demo-api-key",
    authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || "demo-project.firebaseapp.com",
    projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || "demo-project",
    storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET || "demo-project.appspot.com",
    messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "123456789",
    appId: import.meta.env.PUBLIC_FIREBASE_APP_ID || "1:123456789:web:abcdef"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(console.error);

// ============================================================
// Constants & Config
// ============================================================
const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const CIRCUMFERENCE = 2 * Math.PI * 22; // for 48px progress ring

// ============================================================
// Utility Functions
// ============================================================
function $(id: string): HTMLElement { return document.getElementById(id)!; }
function $$(selector: string): NodeListOf<HTMLElement> { return document.querySelectorAll(selector); }

function formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(1) + 'M';
    if (tokens >= 1_000) return (tokens / 1_000).toFixed(1) + 'K';
    return tokens.toString();
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function countWords(text: string): number {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function updateProgress(percent: number, text?: string) {
    const circle = $('progressRing')?.querySelector('.progress-ring__circle');
    const textEl = $('progressText');
    if (circle) circle.style.strokeDashoffset = String(CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE);
    if (textEl) textEl.textContent = Math.round(percent) + '%';
    if (text) {
        const loadingText = document.getElementById('loadingText');
        if (loadingText) loadingText.textContent = text;
    }
}

function showLoading(show: boolean, text?: string) {
    const overlay = $('loadingOverlay');
    if (overlay) {
        overlay.classList.toggle('open', show);
        overlay.setAttribute('aria-hidden', String(!show));
    }
    if (text) {
        const loadingText = document.getElementById('loadingText');
        if (loadingText) loadingText.textContent = text;
    }
}

function showToast(message: string, type: 'success' | 'error' = 'success') {
    const container = $('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                ${type === 'success'
                    ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
                    : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'}
            </svg>
        </div>
        <span class="toast-message">${message}</span>
        <button class="toast-close" aria-label="Dismiss"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    `;
    container.appendChild(toast);
    toast.querySelector('.toast-close')?.addEventListener('click', () => toast.remove());
    setTimeout(() => toast.remove(), 5000);
}

// ============================================================
// Auth & User State
// ============================================================
let currentUser: any = null;
let currentTier = 'free';

function initAuth() {
    // Try anonymous sign-in for dev mode
    if (import.meta.env.PUBLIC_FIREBASE_API_KEY?.startsWith('demo')) {
        signInAnonymously(auth).catch(console.error);
    }
}

// ============================================================
// API Client
// ============================================================
async function apiRequest(endpoint: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers as Record<string, string>,
    };

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include',
    });

    if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
            const err = await response.json();
            detail = err.detail || detail;
        } catch {}
        throw new Error(detail);
    }
    return response.json();
}

// ============================================================
// Theme Toggle
// ============================================================
function initTheme() {
    const toggle = $('themeToggle');
    const sunIcon = toggle?.querySelector('.sun-icon') as HTMLElement;
    const moonIcon = toggle?.querySelector('.moon-icon') as HTMLElement;

    // Check saved preference or system preference
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = saved ? saved === 'dark' : prefersDark;

    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    sunIcon.style.display = isDark ? 'block' : 'none';
    moonIcon.style.display = isDark ? 'none' : 'block';

    toggle?.addEventListener('click', () => {
        const isNowDark = document.documentElement.getAttribute('data-theme') !== 'dark';
        document.documentElement.setAttribute('data-theme', isNowDark ? 'dark' : 'light');
        localStorage.setItem('theme', isNowDark ? 'dark' : 'light');
        sunIcon.style.display = isNowDark ? 'block' : 'none';
        moonIcon.style.display = isNowDark ? 'none' : 'block';
    });
}

// ============================================================
// Mobile Menu
// ============================================================
function initMobileMenu() {
    const toggle = $('menuToggle');
    const drawer = $('mobileDrawer');
    const overlay = $('drawerOverlay');
    const close = $('drawerClose');

    function open() {
        drawer?.classList.add('open');
        overlay?.classList.add('open');
        toggle?.setAttribute('aria-expanded', 'true');
        overlay?.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }
    function closeMenu() {
        drawer?.classList.remove('open');
        overlay?.classList.remove('open');
        toggle?.setAttribute('aria-expanded', 'false');
        overlay?.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    toggle?.addEventListener('click', open);
    close?.addEventListener('click', closeMenu);
    overlay?.addEventListener('click', closeMenu);

    // Close on link click
    $$('.mobile-nav a').forEach(a => a.addEventListener('click', closeMenu));
}

// ============================================================
// Input Text Handling
// ============================================================
function initTextInput() {
    const input = $('inputText') as HTMLTextAreaElement;
    const countEl = $('inputCount');
    const outputInfo = $('outputInfo');
    let estimateTimeout: number;

    function updateCount() {
        const text = input.value;
        const words = countWords(text);
        const chars = text.length;
        if (countEl) countEl.textContent = `${words} words, ${chars} chars`;
        if (outputInfo && !text) outputInfo.textContent = 'Ready to convert';
    }

    input?.addEventListener('input', () => {
        updateCount();
        if (estimateTimeout) clearTimeout(estimateTimeout);
        // Auto-estimate after 500ms of no typing
        estimateTimeout = window.setTimeout(estimateTokens, 500);
    });

    input?.addEventListener('paste', () => {
        setTimeout(updateCount, 0);
    });

    updateCount();
}

function countWords(text: string): number {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
}

// ============================================================
// File Upload
// ============================================================
function initFileUpload() {
    const fileInput = $('fileInput') as HTMLInputElement;
    const inputText = $('inputText') as HTMLTextAreaElement;

    fileInput?.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        if (file.size > 10 * 1024 * 1024) {
            showToast('File too large. Max 10MB.', 'error');
            return;
        }

        const text = await file.text();
        const textarea = document.getElementById('inputText') as HTMLTextAreaElement;
        if (textarea) {
            textarea.value = text;
            textarea.dispatchEvent(new Event('input'));
        }
        showToast(`Loaded ${file.name}`);
        if (e.target) (e.target as HTMLInputElement).value = '';
    });
}

// ============================================================
// Estimate Tokens
// ============================================================
async function estimateTokens() {
    const inputText = (document.getElementById('inputText') as HTMLTextAreaElement)?.value || '';
    if (!inputText.trim()) {
        resetStats();
        return;
    }

    try {
        const data = await apiRequest('/estimate', {
            method: 'POST',
            body: JSON.stringify({ text: inputText, mode: 'dense' }),
        });

        const statText = $('statTextTokens');
        const statImage = $('statImageTokens');
        const statSavings = $('statSavings');
        const statRatio = $('statRatio');

        if (statText) statText.textContent = formatTokenCount(data.text_tokens);
        if (statImage) statImage.textContent = formatTokenCount(data.estimated_image_tokens);
        if (statSavings) statSavings.textContent = data.estimated_savings_percent + '%';
        if (statRatio) statRatio.textContent = data.estimated_savings_percent > 0
            ? (data.text_tokens / Math.max(data.estimated_image_tokens, 1)).toFixed(1) + 'x'
            : '0x';

        updateProgress(Math.min(100, data.estimated_savings_percent + 20));

        const infoEl = document.getElementById('outputInfo');
        if (infoEl) infoEl.textContent = data.would_be_worse
            ? '⚠ Image would cost more tokens'
            : `~${formatTokenCount(data.estimated_image_tokens)} image tokens`;

    } catch (e) {
        console.error('Estimate failed:', e);
        resetStats();
    }
}

function resetStats() {
    ['statTextTokens', 'statImageTokens', 'statSavings', 'statRatio'].forEach(id => {
        const el = $(id);
        if (el) el.textContent = id === 'statSavings' ? '0%' : '0';
    });
    updateProgress(0);
    const infoEl = document.getElementById('outputInfo');
    if (infoEl) infoEl.textContent = 'Ready to convert';
}

// ============================================================
// Convert to PNG
// ============================================================
async function convertToPng() {
    const inputText = (document.getElementById('inputText') as HTMLTextAreaElement)?.value || '';
    if (!inputText.trim()) {
        showToast('Please enter some text first', 'error');
        return;
    }

    const convertBtn = $('convertBtn') as HTMLButtonElement;
    const originalHtml = convertBtn?.innerHTML;

    try {
        showLoading(true, 'Converting to dense PNG...');
        convertBtn && (convertBtn.disabled = true);
        convertBtn && (convertBtn.innerHTML = `
            <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></svg>
            Converting...
        `);

        const data = await apiRequest('/convert-text', {
            method: 'POST',
            body: JSON.stringify({ text: inputText, filename: 'text.txt', mode: 'dense', line_numbers: false, optimize: true }),
        });

        // Update output
        const outputText = $('outputText') as HTMLTextAreaElement;
        if (outputText) outputText.value = data.pages[0]?.data || '';

        // Update stats
        if (data.stats) {
            const statText = $('statTextTokens');
            const statImage = $('statImageTokens');
            const statSavings = $('statSavings');
            const statRatio = $('statRatio');
            if (statText) statText.textContent = data.stats.text_tokens_display;
            if (statImage) statImage.textContent = data.stats.image_tokens_display;
            if (statSavings) statSavings.textContent = data.stats.savings_percent + '%';
            if (statRatio) statRatio.textContent = data.stats.compression_ratio + 'x';
            updateProgress(Math.min(100, data.stats.savings_percent + 5));
        }

        // Update output info
        const infoEl = document.getElementById('outputInfo');
        if (infoEl && data.pages[0]) {
            infoEl.textContent = `${data.pages[0].width}×${data.pages[0].height} • ${data.pages[0].tokens} tokens`;
        }

        showToast('Conversion complete!', 'success');

    } catch (err: any) {
        showToast(err.message || 'Conversion failed', 'error');
        resetStats();
    } finally {
        showLoading(false);
        convertBtn && (convertBtn.disabled = false);
        convertBtn && (convertBtn.innerHTML = originalHtml);
    }
}

// ============================================================
// Download Helpers
// ============================================================
function downloadBase64(base64: string, filename: string) {
    const link = document.createElement('a');
    link.href = base64;
    link.download = filename;
    link.click();
}

function initDownloads() {
    const outputText = $('outputText') as HTMLTextAreaElement;

    $('copyOutput')?.addEventListener('click', async () => {
        if (!outputText?.value) { showToast('Nothing to copy', 'error'); return; }
        try {
            await navigator.clipboard.writeText(outputText.value);
            showToast('Base64 copied to clipboard!');
        } catch { showToast('Failed to copy', 'error'); }
    });

    $('downloadPng')?.addEventListener('click', () => {
        if (!outputText?.value) { showToast('No image to download', 'error'); return; }
        const b64 = outputText.value;
        const byteString = atob(b64.split(',')[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const blob = new Blob([ab], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `tokensaver_${Date.now()}.png`;
        link.click();
        URL.revokeObjectURL(url);
    });

    $('downloadZip')?.addEventListener('click', async () => {
        if (!outputText?.value) { showToast('No image to zip', 'error'); return; }
        try {
            const JSZip = (window as any).JSZip;
            const zip = new JSZip();
            const b64 = outputText.value.split(',')[1];
            zip.file(`tokensaver_${Date.now()}.png`, b64, { base64: true });
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `tokensaver_${Date.now()}.zip`;
            link.click();
            URL.revokeObjectURL(url);
            showToast('ZIP downloaded!');
        } catch { showToast('Failed to create ZIP', 'error'); }
    });

    $('clearInput')?.addEventListener('click', () => {
        const input = document.getElementById('inputText') as HTMLTextAreaElement;
        const output = document.getElementById('outputText') as HTMLTextAreaElement;
        if (input) { input.value = ''; input.dispatchEvent(new Event('input')); }
        if (output) output.value = '';
        resetStats();
    });
}

// ============================================================
// API Request Helper
// ============================================================
async function apiRequest(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers as Record<string, string> },
        credentials: 'include',
    });
    if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try { const err = await response.json(); detail = err.detail || detail; } catch {}
        throw new Error(detail);
    }
    return response.json();
}

// ============================================================
// Initialize
// ============================================================
function init() {
    initAuth();
    initTheme();
    initMobileMenu();
    initTextInput();
    initFileUpload();
    initDownloads();

    // Event listeners
    $('convertBtn')?.addEventListener('click', convertToPng);
    $('estimateBtn')?.addEventListener('click', estimateTokens);
    $('checkAiBtn')?.addEventListener('click', () => showToast('AI check coming soon', 'error'));
    $('estimateBtn')?.addEventListener('click', estimateTokens);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            convertToPng();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            e.preventDefault();
            estimateTokens();
        }
    });

    console.log('TokenSaver v2.1 ready');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}