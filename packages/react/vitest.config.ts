import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

const packageRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the package name to the barrel so publicExports.test.tsx
      // exercises src/index.ts exports without requiring gitignored dist/.
      '@jsonschema-form/react': path.join(packageRoot, 'src/index.ts'),
    },
  },
  plugins: [react() as any],
  test: {
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-test/**'],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      headless: true,
    },
  },
})
