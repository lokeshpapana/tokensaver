// Authenticated API Client
import { getAuth } from 'firebase/auth';
import { getIdToken } from 'firebase/auth';

const API_BASE = '/api';

async function getAuthHeaders(): Promise<Record<string, string>> {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return {};
    
    try {
        const token = await getIdToken(user, true);
        return { 'Authorization': `Bearer ${token}` };
    } catch (e) {
        console.warn('Failed to get ID token:', e);
        return {};
    }
}

export interface ApiResponse<T> {
    data: T;
    rateLimit: Record<string, string>;
}

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public rateLimit: Record<string, string> = {}
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const authHeaders = await getAuthHeaders();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers as Record<string, string>,
        ...authHeaders,
    };

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
        throw new ApiError(response.status, detail, rateLimit);
    }

    const data = await response.json();
    return { data, rateLimit };
}

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public rateLimit: Record<string, string> = {}
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export const api = {
    // Convert file
    convertFile: async (file: File, mode: string, lineNumbers: boolean) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', mode);
        formData.append('line_numbers', lineNumbers.toString());
        
        const authHeaders = await getAuthHeaders();
        return fetch('/api/convert', {
            method: 'POST',
            headers: authHeaders,
            body: formData,
        });
    },

    // Convert text
    convertText: async (text: string, filename: string, mode: string, lineNumbers: boolean) => {
        const authHeaders = await getAuthHeaders();
        return fetch(`/api/convert-text?mode=${mode}&line_numbers=${lineNumbers}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ text, filename }),
        });
    },

    // Batch convert
    convertBatch: async (files: File[], mode: string, lineNumbers: boolean) => {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        formData.append('mode', mode);
        formData.append('line_numbers', lineNumbers.toString());
        
        const authHeaders = await getAuthHeaders();
        return fetch(`/api/convert-batch?mode=${mode}&line_numbers=${lineNumbers}`, {
            method: 'POST',
            headers: authHeaders,
            body: formData,
        });
    },

    // Estimate tokens
    estimate: async (text: string, mode: string) => {
        const authHeaders = await getAuthHeaders();
        return fetch(`/api/estimate?mode=${mode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ text }),
        });
    },

    // History
    history: async (limit = 20) => {
        const authHeaders = await getAuthHeaders();
        return fetch(`/api/history?limit=${limit}`, { headers: authHeaders });
    },

    // Stats
    stats: async () => {
        const authHeaders = await getAuthHeaders();
        return fetch('/api/stats', { headers: authHeaders });
    },

    // API Keys
    generateKey: async (tier: string, description: string) => {
        const authHeaders = await getAuthHeaders();
        return fetch('/api/keys/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ tier, description }),
        });
    },

    listKeys: async () => {
        const authHeaders = await getAuthHeaders();
        return fetch('/api/keys/list', { headers: authHeaders });
    },

    revokeKey: async (key: string) => {
        const authHeaders = await getAuthHeaders();
        return fetch('/api/keys/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ api_key: key }),
        });
    },

    // Health
    health: async () => fetch('/api/health'),
};

export async function parseResponse<T>(response: Response): Promise<T> {
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