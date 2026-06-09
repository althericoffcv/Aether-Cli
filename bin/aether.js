#!/usr/bin/env node
import { main } from '../src/cli/index.mjs'

main().catch(err => {
  console.error(`\x1b[31m✗ Fatal: ${err.message}\x1b[0m`)
  if (process.env.AETHER_DEBUG) console.error(err.stack)
  process.exit(1)
})
