import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  // Some macOS setups block editor-sandboxed Node processes from reading files under Desktop/Documents.
  // If `.env.local` exists but isn't readable (EPERM), Vite fails while loading env.
  // Work around it by falling back to `app/env/` as the env dir.
  //
  // If you want env files locally, put them in `app/env/` (e.g. `app/env/.env.local`).
  envDir: (() => {
    const root = __dirname
    const envLocal = path.join(root, '.env.local')
    try{
      fs.accessSync(envLocal, fs.constants.R_OK)
      return root
    }catch (e){
      const code = e?.code ? String(e.code) : ''
      if (code === 'EPERM' || code === 'EACCES'){
        return path.join(root, 'env')
      }
      return root
    }
  })(),
  plugins: [react()],
})
