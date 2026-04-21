/**
 * Railway/Docker BuildKit: deleting `node_modules` hits EBUSY on `.cache` / `.vite`.
 * Renaming the folder avoids rmdir on stuck paths. Parking uses a sibling path under
 * the same directory as `node_modules` (not /tmp) so we never cross filesystems (EXDEV).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const nm = path.join(process.cwd(), 'node_modules')

if (!fs.existsSync(nm)) {
  process.exit(0)
}

const parent = path.dirname(nm)
const parked = path.join(
  parent,
  `node_modules.__parked__${crypto.randomBytes(8).toString('hex')}`
)

try {
  fs.renameSync(nm, parked)
  process.exit(0)
} catch {
  /* fall through */
}

const peelTrash = path.join(
  parent,
  `node_modules.__peel__${crypto.randomBytes(4).toString('hex')}`
)
try {
  fs.mkdirSync(peelTrash, { recursive: true })
} catch {
  /* ignore */
}

for (const rel of ['.cache', '.vite', '.tmp']) {
  const from = path.join(nm, rel)
  if (!fs.existsSync(from)) continue
  const to = path.join(peelTrash, rel)
  try {
    fs.renameSync(from, to)
  } catch {
    /* continue */
  }
}

try {
  fs.rmSync(nm, {
    recursive: true,
    force: true,
    maxRetries: 25,
    retryDelay: 400,
  })
} catch (first) {
  try {
    fs.renameSync(nm, parked)
  } catch (second) {
    console.error(
      '[railway-prebuild] Could not park or remove node_modules:',
      first?.message ?? first,
      '|',
      second?.message ?? second
    )
    console.error(
      '[railway-prebuild] In Railway: clear this service’s build cache, then redeploy.'
    )
    process.exit(1)
  }
}

process.exit(0)
