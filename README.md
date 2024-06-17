# Email Backup

## Description

This script is used to back up emails from a mail server to a local directory.
It uses the IMAP protocol to connect to the mail server and download the emails. The emails are stored in Markdown
format.

## Additions in this Fork:

- A folder is created per Email ( in the format of `YYYY-MM-DD_h-m-s __SPAM__ from subject` )
- Folder name is sanitized to prevent conflicts
- HTML in any email is translated into Makrdown
- Email Meta information is appended to the top of each md file
- The full Email Object is stored in a JSON file
- If there are any attachments they will be saved into a Zip file
- files are stored inside the MAIL folder, one subfolder per env file and each have subfolders for mailboxes
- last execution is saved in MAIL folder
- added `start` and `end` arguments
- end defaults to tomorrow
- start tries to read the last execution and use this date or falls back to last month
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
