// Firebase Auth Component
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut, 
    onAuthStateChanged,
    sendPasswordResetEmail,
    signInAnonymously,
    User
} from 'firebase/auth';

// Firebase config - replace with your config
const firebaseConfig = {
    apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY || "YOUR_API_KEY",
    authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || "YOUR_PROJECT.firebaseapp.com",
    projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
    storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT.appspot.com",
    messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "YOUR_SENDER_ID",
    appId: import.meta.env.PUBLIC_FIREBASE_APP_ID || "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let currentUser: User | null = null;
const authListeners: Array<(user: User | null) => void> = [];

// Auth state listener
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    authListeners.forEach(listener => listener(user));
    updateAuthUI(user);
});

export function onAuthChange(listener: (user: User | null) => void) {
    authListeners.push(listener);
    if (currentUser !== undefined) listener(currentUser);
}

function updateAuthUI(user: User | null) {
    const authBar = document.getElementById('authBar');
    if (!authBar) return;
    
    if (user) {
        const displayName = user.displayName || user.email?.split('@')[0] || 'User';
        authBar.innerHTML = `
            <div class="user-menu">
                <span class="user-info">👤 ${displayName} (${user.emailVerified ? 'verified' : 'unverified'})</span>
                <button class="btn btn-secondary btn-sm" id="signOutBtn">Sign Out</button>
                <button class="btn btn-primary btn-sm" id="manageKeysBtn">API Keys</button>
            </div>
        `;
        document.getElementById('signOutBtn')?.addEventListener('click', () => signOut(auth));
        document.getElementById('manageKeysBtn')?.addEventListener('click', showKeyManager);
    } else {
        authBar.innerHTML = `
            <div class="auth-buttons">
                <button class="btn btn-primary btn-sm" id="signInBtn">Sign In</button>
                <button class="btn btn-secondary btn-sm" id="signUpBtn">Sign Up</button>
                <button class="btn btn-secondary btn-sm" id="anonBtn">Continue Anonymously</button>
            </div>
        `;
        document.getElementById('signInBtn')?.addEventListener('click', () => showAuthModal('signin'));
        document.getElementById('signUpBtn')?.addEventListener('click', () => showAuthModal('signup'));
        document.getElementById('anonBtn')?.addEventListener('click', () => signInAnonymously(auth));
    }
}

// Auth Modal
function showAuthModal(mode: 'signin' | 'signup' | 'reset') {
    const modal = document.getElementById('authModal');
    const title = document.getElementById('authModalTitle');
    const form = document.getElementById('authForm');
    if (!modal || !title || !form) return;
    
    const titles = { signin: 'Sign In', signup: 'Create Account', reset: 'Reset Password' };
    title.textContent = titles[mode];
    
    form.innerHTML = getAuthFormHTML(mode);
    modal.classList.remove('hidden');
    
    // Form handlers
    const submitForm = form.querySelector('form');
    submitForm?.addEventListener('submit', (e) => handleAuthSubmit(e, mode));
    
    // Switch links
    form.querySelectorAll('.auth-switch').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const newMode = (e.target as HTMLAnchorElement).dataset.mode;
            if (newMode) showAuthModal(newMode as 'signin' | 'signup' | 'reset');
        });
    });
    
    // Close handlers
    document.getElementById('authModalClose')?.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
}

function getAuthFormHTML(mode: string): string {
    if (mode === 'reset') {
        return `
            <form>
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" name="email" required autocomplete="email">
                </div>
                <button type="submit" class="btn btn-primary">Send Reset Email</button>
                <p class="auth-switch"><a href="#" data-mode="signin">Back to Sign In</a></p>
            </form>
        `;
    }
    
    return `
        <form>
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
                <input type="password" name="password" required minlength="6" autocomplete="current-password">
            </div>
            <button type="submit" class="btn btn-primary">${mode === 'signup' ? 'Create Account' : 'Sign In'}</button>
            <p class="auth-switch">
                ${mode === 'signup' 
                    ? 'Already have an account? <a href="#" data-mode="signin">Sign In</a>'
                    : 'Need an account? <a href="#" data-mode="signup">Sign Up</a> | <a href="#" data-mode="reset">Forgot Password?</a>'
                }
            </p>
        </form>
    `;
}

async function handleAuthSubmit(e: Event, mode: string) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const displayName = formData.get('displayName') as string;
    
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';
    
    try {
        if (mode === 'signup') {
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            if (displayName && cred.user) {
                await cred.user.updateProfile({ displayName });
            }
        } else if (mode === 'signin') {
            await signInWithEmailAndPassword(auth, email, password);
        } else if (mode === 'reset') {
            await sendPasswordResetEmail(auth, email);
            alert('Password reset email sent!');
            showAuthModal('signin');
            return;
        }
        closeAuthModal();
    } catch (err: any) {
        const messages: Record<string, string> = {
            'auth/email-already-in-use': 'Email already registered. Try signing in.',
            'auth/invalid-email': 'Invalid email address.',
            'auth/weak-password': 'Password must be at least 6 characters.',
            'auth/user-not-found': 'No account found with this email.',
            'auth/wrong-password': 'Incorrect password.',
            'auth/too-many-requests': 'Too many attempts. Try again later.',
        };
        alert(messages[err.code] || err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

function closeAuthModal() {
    document.getElementById('authModal')?.classList.add('hidden');
}

// API Key Manager Modal
async function showKeyManager() {
    // Implementation in app.ts
    const { showKeyManagerModal } = await import('./app');
    showKeyManagerModal();
}

export function initAuth() {
    // Initialize auth state
    updateAuthUI(currentUser);
}