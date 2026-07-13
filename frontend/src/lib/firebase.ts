// Firebase configuration
import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDkdSuKxvUbH8zd-nNpIpDBeI2gm4-k74o",
  authDomain: "tokensaver-11e5a.firebaseapp.com",
  projectId: "tokensaver-11e5a",
  storageBucket: "tokensaver-11e5a.firebasestorage.app",
  messagingSenderId: "263886692436",
  appId: "1:263886692436:web:c132166a52505b3ab94dc1",
  measurementId: "G-12X26ZNEJJ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable persistence for offline support
setPersistence(auth, browserLocalPersistence).catch(console.error);