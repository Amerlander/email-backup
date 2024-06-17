# Email Backup

## Description

This script is used to back up emails from a mail server to a local directory.
It uses the IMAP protocol to connect to the mail server and download the emails. The emails are stored in Markdown
format.

## Additions in this Fork:
- Save Emails:
  - Full Email as .eml file
  - HTML Body + Email Meta as markdown file with images as local assets
  - Attachments as .zip
  - ~~The full Email Object is stored in a JSON file~~ (removed again in favor of .eml files)
- Folder structure
  - MAIL
    - [name_of_env_file]
      - [inbox name]
        - A folder per Email ( in the format of `YYYY-MM-DD_h-m-s __SPAM__ from subject` )
          - assets/[i].jpg/png/gif/... (for images linked in the email)
          - *.md
          - *.eml
          - *.zip
- Folder name is sanitized to prevent conflicts with special characters
- last execution is saved in MAIL folder
- added `start` and `end` arguments
- `end` defaults to tomorrow
- `start` tries to read the *last execution* and use this date or falls back to *last month*
- removed `from` and `output` arguments
- removed passwords from env file and promt after starting the command

## Usage

The script can be run with the following command:

```bash
npx email-backup --envFile <path to env file> --start "2020-01-01" --end "2023-01-02"
```

Or to just fetch emails from last execution / month until now
```bash
npx email-backup --envFile <path to env file>
```
