import { copyFileSync } from 'node:fs'

copyFileSync(new URL('../electron/preload.cjs', import.meta.url), new URL('../dist/electron/preload.cjs', import.meta.url))
