# Email Backup

## Description

This script is used to back up emails from a mail server to a local directory.
It uses the IMAP protocol to connect to the mail server and download the emails. The emails are stored in Markdown
format.

## Additions in this Fork:

- A folder is created per Email ( in the format of `YYYY-MM-DD_h-m-s from subject id` )
- Folder name is sanitized to prevent conflicts
- HTML in any email is translated into Makrdown
- Email Meta information is appended to the top of each md file
- The full Email Object is stored in a JSON file
- If there are any attachments they will be saved into a Zip file
- added `start` and `end` arguments
- removed `from` argumnt

## Usage

The script can be run with the following command:

```bash
npx email-backup --envFile <path to env file> --output <output directory> --start "2020-01-01" --end "2023-01-02"
```

Or to just fetch emails from last month:
```bash
npx email-backup --envFile <path to env file> --output <output directory>
```
