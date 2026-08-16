import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

type FirebaseGlobals = {
  __sellmateFirebaseApp?: FirebaseApp;
  __sellmateFirestore?: Firestore;
};

const globals = globalThis as typeof globalThis & FirebaseGlobals;

console.log(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);

function getFirebaseApp(): FirebaseApp {
  if (globals.__sellmateFirebaseApp) {
    return globals.__sellmateFirebaseApp;
  }

  const app =
    getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  globals.__sellmateFirebaseApp = app;
  return app;
}

function getDb(): Firestore {
  if (globals.__sellmateFirestore) {
    return globals.__sellmateFirestore;
  }

  const app = getFirebaseApp();

  // experimentalForceLongPolling is not supported in Node. Next.js still
  // evaluates this module during SSR of client pages; applying it there can
  // leave getDocs hanging in Safari with no exception.
  if (typeof window === "undefined") {
    globals.__sellmateFirestore = getFirestore(app);
    return globals.__sellmateFirestore;
  }

  try {
    globals.__sellmateFirestore = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      localCache: memoryLocalCache(),
    });
  } catch {
    globals.__sellmateFirestore = getFirestore(app);
  }

  return globals.__sellmateFirestore;
}

export const db = getDb();
