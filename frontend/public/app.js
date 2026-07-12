const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const fileItems = document.getElementById('fileItems');
const convertBtn = document.getElementById('convertBtn');
const clearBtn = document.getElementById('clearBtn');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const textInput = document.getElementById('textInput');
const convertTextBtn = document.getElementById('convertTextBtn');
const charCount = document.getElementById('charCount');
const estimateBox = document.getElementById('estimateBox');

let selectedFiles = [];
let estimateTimeout = null;
let currentResult = null;
const CIRCUMFERENCE = 2 * Math.PI * 54;

class TokenSaverDB {
    constructor() { this.db = null; }
    async init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('tokensaver_history', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('conversions')) {
                    const store = db.createObjectStore('conversions', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            req.onerror = () => reject(req.error);
        });
    }
    async save(record) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('conversions', 'readwrite');
            const req = tx.objectStore('conversions').add(record);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    async getAll(limit = 50) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('conversions', 'readonly');
            const req = tx.objectStore('conversions').index('timestamp').openCursor(null, 'prev');
            const results = [];
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }
    async delete(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('conversions', 'readwrite');
            tx.objectStore('conversions').delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
    async clear() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('conversions', 'readwrite');
            tx.objectStore('conversions').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

const db = new TokenSaverDB();

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatTokenCount(tokens) {
    if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
    if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
    return tokens.toString();
}

function showProgress(percent, text) {
    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
    document.getElementById('progressCircle').style.strokeDashoffset = offset;
    document.getElementById('progressPercent').textContent = Math.round(percent) + '%';
    document.getElementById('progressText').textContent = text;
}

function showLoading(show = true) {
    loading.classList.toggle('hidden', !show);
    if (show) {
        showProgress(0, 'Starting conversion...');
    }
}

function showResults(data) {
    currentResult = data;
    document.getElementById('textTokens').textContent = data.stats.text_tokens_display;
    document.getElementById('imageTokens').textContent = data.stats.image_tokens_display;
    document.getElementById('savingsBadge').textContent = data.stats.savings_percent + '% SAVED';

    const recEl = document.getElementById('recommendation');
    if (data.stats.recommendation) {
        recEl.textContent = data.stats.recommendation;
        recEl.style.display = 'block';
    } else {
        recEl.style.display = 'none';
    }

    const preview = document.getElementById('pagePreview');
    preview.innerHTML = '<div class="page-grid">' +
        data.pages.map(p => `
            <div class="page-card">
                <img src="${p.data}" alt="Page ${p.page}">
                <div class="info">
                    Page <span>${p.page}/${p.total_pages}</span> -
                    <span>${p.width}x${p.height}</span> -
                    <span>${p.tokens} tokens</span>
                </div>
            </div>
        `).join('') + '</div>';

    document.getElementById('downloadAllBtn').onclick = async () => {
        const zip = new JSZip();
        data.pages.forEach(p => {
            const b64 = p.data.split(',')[1];
            zip.file(`${data.filename.replace(/\.[^.]+$/, '')}_p${p.page}.png`, b64, { base64: true });
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${data.filename.replace(/\.[^.]+$/, '')}.zip`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    results.classList.remove('hidden');
    loadHistory();
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

function handleFiles(files) {
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

function updateFileList() {
    if (selectedFiles.length === 0) {
        fileList.classList.add('hidden');
        convertBtn.disabled = true;
        clearBtn.classList.add('hidden');
        return;
    }
    fileList.classList.remove('hidden');
    convertBtn.disabled = false;
    clearBtn.classList.remove('hidden');
    fileItems.innerHTML = selectedFiles.map((f, i) => `
        <div class="file-item">
            <span class="file-name">${f.name}</span>
            <span class="file-size">${formatSize(f.size)}</span>
            <button class="file-remove" onclick="removeFile(${i})">&#10005;</button>
        </div>
    `).join('');
}

function removeFile(idx) {
    selectedFiles.splice(idx, 1);
    updateFileList();
}

clearBtn.addEventListener('click', () => {
    selectedFiles = [];
    updateFileList();
    results.classList.add('hidden');
});

textInput.addEventListener('input', () => {
    const len = textInput.value.length;
    charCount.textContent = len.toLocaleString() + ' characters';
    convertTextBtn.disabled = len === 0;

    if (estimateTimeout) clearTimeout(estimateTimeout);
    if (len > 0) {
        estimateTimeout = setTimeout(() => getEstimate(textInput.value), 500);
    } else {
        estimateBox.style.display = 'none';
    }
});

async function getEstimate(text) {
    const mode = document.getElementById('modeSelect').value;
    try {
        const resp = await fetch('/api/estimate?mode=' + mode, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });
        if (!resp.ok) return;
        const data = await resp.json();

        document.getElementById('estChars').textContent = data.chars.toLocaleString();
        document.getElementById('estTextTokens').textContent = formatTokenCount(data.text_tokens);
        document.getElementById('estImageTokens').textContent = formatTokenCount(data.estimated_image_tokens);
        document.getElementById('estSavings').textContent = data.estimated_savings_percent + '%';

        const worseEl = document.getElementById('estWorse');
        if (data.would_be_worse) {
            worseEl.classList.remove('hidden');
            estimateBox.classList.add('worse');
            estimateBox.classList.remove('good');
            convertTextBtn.disabled = true;
            convertTextBtn.textContent = 'Image Costs More - Send as Text';
        } else {
            worseEl.classList.add('hidden');
            estimateBox.classList.remove('worse');
            estimateBox.classList.add('good');
            convertTextBtn.disabled = false;
            convertTextBtn.textContent = 'Convert Text to PNG';
        }
        estimateBox.style.display = 'block';
    } catch (e) { console.error('Estimate error:', e); }
}

async function saveToHistory(data) {
    try {
        await db.save({
            filename: data.filename,
            fileType: data.file_type,
            chars: data.stats.characters,
            textTokens: data.stats.text_tokens,
            imageTokens: data.stats.image_tokens,
            savings: data.stats.savings_percent,
            pages: data.pages.map(p => ({ page: p.page, data: p.data, width: p.width, height: p.height, tokens: p.tokens })),
            timestamp: new Date().toISOString()
        });
    } catch (e) { console.error('Save to history error:', e); }
}

convertTextBtn.addEventListener('click', async () => {
    const text = textInput.value;
    if (!text.trim()) return;

    const startTime = Date.now();
    showLoading(true);
    results.classList.add('hidden');
    convertTextBtn.disabled = true;

    const estimatedChars = text.length;
    const estimatedSeconds = Math.max(1, estimatedChars / 60000);
    let progressInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const percent = Math.min(95, (elapsed / estimatedSeconds) * 100);
        const remaining = Math.max(0, estimatedSeconds - elapsed);
        showProgress(percent, `Rendering... ~${Math.ceil(remaining)}s left`);
    }, 200);

    try {
        const resp = await fetch('/api/convert-text?mode=' + document.getElementById('modeSelect').value +
            '&line_numbers=' + document.getElementById('lineNumbers').checked, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, filename: 'pasted_text.txt' })
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || 'Conversion failed');
        }
        const data = await resp.json();
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        showProgress(100, `Done in ${elapsed}s`);
        setTimeout(() => {
            showLoading(false);
            showResults(data);
            saveToHistory(data);
        }, 500);
    } catch (err) {
        showLoading(false);
        alert('Error: ' + err.message);
    } finally {
        clearInterval(progressInterval);
        convertTextBtn.disabled = false;
    }
});

convertBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;

    const startTime = Date.now();
    showLoading(true);
    results.classList.add('hidden');
    convertBtn.disabled = true;

    try {
        if (selectedFiles.length === 1) {
            await convertSingle(selectedFiles[0], startTime);
        } else {
            await convertBatch(selectedFiles, startTime);
        }
    } catch (err) {
        showLoading(false);
        alert('Error: ' + err.message);
    } finally {
        convertBtn.disabled = false;
    }
});

async function convertSingle(file, startTime) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', document.getElementById('modeSelect').value);
    formData.append('line_numbers', document.getElementById('lineNumbers').checked);

    showProgress(30, 'Uploading file...');

    const resp = await fetch('/api/convert', { method: 'POST', body: formData });
    if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || 'Conversion failed');
    }
    const data = await resp.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    showProgress(100, `Done in ${elapsed}s`);
    setTimeout(() => {
        showLoading(false);
        showResults(data);
        saveToHistory(data);
    }, 500);
}

async function convertBatch(files, startTime) {
    const formData = new FormData();
    for (const file of files) {
        formData.append('files', file);
    }

    const mode = document.getElementById('modeSelect').value;
    const lineNumbers = document.getElementById('lineNumbers').checked;
    showProgress(30, 'Uploading files...');

    const resp = await fetch(`/api/convert-batch?mode=${mode}&line_numbers=${lineNumbers}`, {
        method: 'POST',
        body: formData
    });
    if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || 'Batch conversion failed');
    }

    showProgress(80, 'Packaging ZIP...');
    const blob = await resp.blob();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    showProgress(100, `Done in ${elapsed}s`);

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tokensaver_batch.zip';
    a.click();
    URL.revokeObjectURL(a.href);

    setTimeout(() => {
        showLoading(false);
        alert('Batch ZIP downloaded!');
    }, 500);
}

async function loadHistory() {
    try {
        const records = await db.getAll(50);
        const tbody = document.getElementById('historyBody');
        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No conversions yet</td></tr>';
            return;
        }
        tbody.innerHTML = records.map(r => `
            <tr>
                <td style="color:#f0f6fc;font-family:monospace;">${r.filename}</td>
                <td>${r.chars ? r.chars.toLocaleString() : '-'}</td>
                <td>${r.textTokens ? formatTokenCount(r.textTokens) : '-'}</td>
                <td>${r.imageTokens ? formatTokenCount(r.imageTokens) : '-'}</td>
                <td style="color:#3fb950;font-weight:bold;">${r.savings ? r.savings + '%' : '-'}</td>
                <td style="color:#8b949e;">${new Date(r.timestamp).toLocaleString()}</td>
                <td>
                    <div class="history-actions">
                        <button class="view-btn" onclick="viewHistoryImage(${r.id})">View</button>
                        <button onclick="downloadHistoryImage(${r.id})">Download</button>
                        <button class="copy-btn" onclick="copyHistoryImage(${r.id})">Copy</button>
                        <button class="delete-btn" onclick="deleteHistoryImage(${r.id})">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (e) { console.error('Load history error:', e); }
}

let currentModalRecord = null;

async function viewHistoryImage(id) {
    const records = await db.getAll(200);
    const record = records.find(r => r.id === id);
    if (!record || !record.pages || record.pages.length === 0) return;
    currentModalRecord = record;
    document.getElementById('modalTitle').textContent = record.filename;
    document.getElementById('modalImage').src = record.pages[0].data;
    document.getElementById('imageModal').classList.remove('hidden');
}

document.getElementById('modalClose').onclick = () => {
    document.getElementById('imageModal').classList.add('hidden');
};
document.getElementById('imageModal').onclick = (e) => {
    if (e.target === document.getElementById('imageModal')) {
        document.getElementById('imageModal').classList.add('hidden');
    }
};

document.getElementById('modalDownload').onclick = () => {
    if (!currentModalRecord) return;
    currentModalRecord.pages.forEach(p => {
        const a = document.createElement('a');
        a.href = p.data;
        a.download = `${currentModalRecord.filename.replace(/\.[^.]+$/, '')}_p${p.page}.png`;
        a.click();
    });
};

document.getElementById('modalCopy').onclick = async () => {
    if (!currentModalRecord || !currentModalRecord.pages[0]) return;
    try {
        await navigator.clipboard.writeText(currentModalRecord.pages[0].data);
        alert('Copied to clipboard!');
    } catch (e) {
        alert('Failed to copy');
    }
};

async function downloadHistoryImage(id) {
    const records = await db.getAll(200);
    const record = records.find(r => r.id === id);
    if (!record || !record.pages) return;
    record.pages.forEach(p => {
        const a = document.createElement('a');
        a.href = p.data;
        a.download = `${record.filename.replace(/\.[^.]+$/, '')}_p${p.page}.png`;
        a.click();
    });
}

async function copyHistoryImage(id) {
    const records = await db.getAll(200);
    const record = records.find(r => r.id === id);
    if (!record || !record.pages || !record.pages[0]) return;
    try {
        await navigator.clipboard.writeText(record.pages[0].data);
        alert('Copied to clipboard!');
    } catch (e) {
        alert('Failed to copy');
    }
}

async function deleteHistoryImage(id) {
    if (!confirm('Delete this conversion from history?')) return;
    try {
        await db.delete(id);
        loadHistory();
    } catch (e) { console.error('Delete error:', e); }
}

document.getElementById('clearHistoryBtn').onclick = async () => {
    if (!confirm('Clear all conversion history?')) return;
    try {
        await db.clear();
        loadHistory();
    } catch (e) { console.error('Clear error:', e); }
};

async function loadStats() {
    try {
        const records = await db.getAll(200);
        document.getElementById('totalConversions').textContent = records.length;
        let totalSaved = 0;
        let totalSavings = 0;
        records.forEach(r => {
            if (r.textTokens && r.imageTokens) {
                totalSaved += r.textTokens - r.imageTokens;
                totalSavings += r.savings || 0;
            }
        });
        document.getElementById('totalSaved').textContent = formatTokenCount(totalSaved);
        if (records.length > 0) {
            document.getElementById('avgSavings').textContent = Math.round(totalSavings / records.length) + '%';
        }
    } catch (e) {}
}

async function init() {
    try {
        await db.init();
    } catch (e) {
        console.error('IndexedDB init failed:', e);
    }
    loadHistory();
    loadStats();
}

init();
