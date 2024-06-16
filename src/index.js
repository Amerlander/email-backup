#!/usr/bin/env node
import { argv, env } from 'node:process'
import dotenv from 'dotenv'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs'
import { fetchAndBackupEmail } from './fetch-and-backup-email.js'
import { addMonths, format } from 'date-fns'

async function main() {
  const args = yargs(hideBin(argv))
    .option('envPath', { describe: 'Environment path' })
    .option('start', { describe: 'Start date for email search', default: format(addMonths(new Date(), -1), 'yyyy-MM-dd') })
    .option('end', { describe: 'End date for email search', default: format(new Date(), 'yyyy-MM-dd') })
    .option('output', { describe: 'Backup Dir path', demandOption: true })
    .parse()

  if (args.envPath) {
    dotenv.config({ path: args.envPath })
  } else {
    dotenv.config()
  }

  const imapConfig = {
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    user: env.IMAP_USER,
    password: env.IMAP_PASSWORD,
  }

  const searchQuery = {
    since: args.start, // Include start date in search query
    before: args.end,  // Include end date in search query
  }

  await fetchAndBackupEmail({ imapConfig, searchQuery, output: args.output })
}

main().catch(console.error)