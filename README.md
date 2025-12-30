## Math Web / Quantara

This repo currently contains:
- **React app (source of truth)**: `app/src` (built output: `app/dist`)
- **Legacy static pages** (older prototypes): `community.html`, `new-post.html`, etc.

### How to test the React Community page

Run the React dev server:

```bash
cd app
npm run dev
```

Then open:
- `http://localhost:5173/community` (community feed + image lightbox)
- `http://localhost:5173/new` (new post + multi-image upload)

### Notes

- Firebase Hosting is configured to serve **`app/dist`** (`firebase.json`), so you must run `cd app && npm run build` before deploying.
- The legacy pages now redirect to the React routes when served over HTTP(S) to avoid testing the wrong UI by accident.
