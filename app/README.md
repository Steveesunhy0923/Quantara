# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Auth notes (dev + prod)

- The login page is at `/login`.
- Email/password sign-in is supported by the UI, but you must enable **Email/Password** in Firebase Console → Authentication → Sign-in method.
- This project intentionally blocks creating a password account for an email that already has **Google** sign-in enabled (and vice-versa), to avoid “same gmail, different login method” confusion.

## Deploy (Hosting)

Firebase Hosting serves `app/dist` (see `firebase.json`). After UI/auth changes:

```sh
cd app
npm run build
cd ..
firebase deploy --only hosting
```
