#!/usr/bin/env node
import { argv, env } from 'node:process'
import dotenv from 'dotenv'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs'
import { fetchAndBackupEmail } from './fetch-and-backup-email.js'
import { addMonths, addDays, format, parseISO } from 'date-fns'
import { access, constants, writeFile, mkdir, readFile } from 'node:fs/promises'
import path from 'path'
// import promptSync from 'prompt-sync'; // Import prompt-sync using default export
import readlineSync from 'readline-sync';

// const prompt = promptSync({ sigint: true }); // Create a prompt instance with sigint option

async function main() {
  const args = yargs(hideBin(argv))
    .option('envPath', { describe: 'Environment path' })
    .option('start', { describe: 'Start date for email search' })
    .option('end', { describe: 'End date for email search', default: format(addDays(new Date(), 1), 'yyyy-MM-dd') })
    .parse()

  let envPath = args.envPath || '.env'
  dotenv.config({ path: envPath })

  const envFileName = path.basename(envPath, path.extname(envPath))
  const outputDir = `./MAIL/${envFileName}`
  const lastExecutionFile = `./MAIL/${envFileName}_last_execution.txt`

  let startDate
  if (args.start) {
    startDate = args.start
  } else {
    try {
      await access(lastExecutionFile, constants.F_OK)
      const lastExecutionDate = await readFile(lastExecutionFile, 'utf8')
      startDate = format(parseISO(lastExecutionDate), 'yyyy-MM-dd')
    } catch {
      startDate = format(addMonths(new Date(), -1), 'yyyy-MM-dd')
    }
  }

  const argsWithDefaults = {
    ...args,
    output: outputDir,
    start: startDate
  }

  // Prompt for IMAP password securely
  const password = readlineSync.question('Enter IMAP password: ', {
    hideEchoBack: true,
    mask: '*' // Optional, can be used instead of hideEchoBack
  });

  // Prompt for IMAP password
  // const password = prompt('Enter IMAP password: ', { hideEchoBack: true });
  if (!password) {
    console.error('IMAP password is required.');
    process.exit(1);
  }

  const imapConfig = {
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    user: env.IMAP_USER,
    // password: env.IMAP_PASSWORD,
    password: password
  }

  const searchQuery = {
    since: argsWithDefaults.start,
    before: argsWithDefaults.end,
  }

  console.log(searchQuery)

  // Ensure the output directory exists
  try {
    await access(outputDir, constants.F_OK)
  } catch {
    await mkdir(outputDir, { recursive: true })
  }

  await fetchAndBackupEmail({ imapConfig, searchQuery, output: argsWithDefaults.output })

  // Save the current date as the last execution date
  await writeFile(lastExecutionFile, new Date().toISOString())
}

main().catch(console.error)
