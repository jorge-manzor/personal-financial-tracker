/**
 * Railway/Docker: `rm -rf node_modules` can hit EBUSY on subpaths like
 * `node_modules/.vite` or `node_modules/.cache`. Node's rmSync with retries
 * handles many of those races; caches are also moved out of node_modules via
 * vite.config + tsconfigs.
 */
import fs from 'node:fs'
import path from 'node:path'

const nm = path.join(process.cwd(), 'node_modules')

if (!fs.existsSync(nm)) {
  process.exit(0)
}

try {
  fs.rmSync(nm, {
    recursive: true,
    force: true,
    maxRetries: 15,
    retryDelay: 300,
  })
} catch (err) {
  console.error('[railway-prebuild] Failed to remove node_modules:', err?.message ?? err)
  process.exit(1)
}
