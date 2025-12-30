import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFunctions } from 'firebase/functions'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: 'AIzaSyCJTmL7fVTkf328MLSr-8je95CqtSxfMo0',
  projectId: 'quantara-1',
  authDomain: 'quantara-1.firebaseapp.com',
  // Keep this in sync with your Firebase project’s Storage bucket.
  // (The emulator/debug log shows the default bucket as `quantara-1.firebasestorage.app`.)
  storageBucket: 'quantara-1.firebasestorage.app',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)
