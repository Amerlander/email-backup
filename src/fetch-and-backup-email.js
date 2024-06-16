import { access, constants, writeFile, mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { ImapClient } from './ImapClient.js'
import archiver from 'archiver'
import { createWriteStream } from 'node:fs'
import Turndown from 'turndown';


export async function fetchAndBackupEmail({ imapConfig, searchQuery, output }) {
  const client = new ImapClient(imapConfig)
  const messages = await client.fetch(searchQuery)
  for (const message of messages) {
    await _saveIfNotExist(message, output)
  }
}

async function _sanitizeFilename(filename) {
  // Replace special characters with underscores
  if(filename && filename.length) {
  return filename
            // .replace(/\./g, 'DOT')
            .replace(/@/g, 'AT')
            .replace(/\s/g, '_')
            .replace(/[^0-9a-zA-Z_-]/g, '-').trim();
  } else {
    return '___';
  }
}

function splitAtLastDot(inputString) {
  // Find the last occurrence of '.'
  let lastIndex = inputString.lastIndexOf('.');
  
  // Check if there is a dot in the string
  if (lastIndex !== -1) {
      // Split the string at the last dot
      let firstPart = inputString.substring(0, lastIndex);
      let secondPart = inputString.substring(lastIndex + 1);
      return [firstPart, secondPart];
  } else {
      // If there's no dot, return the whole string as the first part and an empty string as the second part
      return [inputString, ''];
  }
}

async function convertEmailToMarkdown(email) {
  // Extract metadata
  const from = email.from?.text || 'Unknown Sender';
  const to = email.to?.text || 'Unknown Receiver';
  const subject = email.subject || 'No Subject';
  const date = email.dateString || new Date().toString();
  const attachments = email.attachments.map(att => `[${att.name}](${att.cid})`).join(', ');

  // Convert HTML body to Markdown using Turndown
  const turndownService = new Turndown();
  const markdownBody = (email.textAsHtml) ? turndownService.turndown(email.textAsHtml) : email.text;

  // Construct Markdown content
  const markdownContent = `### Email Metadata:
- **From:** ${from}
- **To:** ${to}
- **Subject:** ${subject}
- **Date:** ${date}
- **Attachments:** ${attachments ?? 'None'}

### Email Body:

${markdownBody}`;

  return markdownContent;
}

async function _saveIfNotExist(mail, output) {
  const sanitizedSubject = (await _sanitizeFilename(mail.subject)).substring(0, 20);
  const sanitizedFrom = mail.from?.value[0].address ? await _sanitizeFilename(mail.from?.value[0].address) : 'NO-FROM';
  const sanitizedSMessageID = (await _sanitizeFilename(mail.messageId)).substring(0, 10);
  const sanitizeDateString = await _sanitizeFilename(mail.dateString);
  const sanitizedTitle = `${sanitizeDateString} ${sanitizedFrom} ${sanitizedSubject} ${sanitizedSMessageID}`;

  const folderPath = join(output, sanitizedTitle);
  const absoluteFolderPath = isAbsolute(output) ? folderPath : resolve(folderPath);
  const mdFilePath = `${absoluteFolderPath}/${sanitizedTitle}.md`;
  const zipFilePath = `${absoluteFolderPath}/${sanitizedTitle}.zip`;
  const jsonFilePath = `${absoluteFolderPath}/${sanitizedTitle}.json`;


  try {
    // Create folder if it doesn't exist
    await mkdir(absoluteFolderPath, { recursive: true });

    // Write email content to .md file
    const markdownContent = await convertEmailToMarkdown(mail);
    await writeFile(mdFilePath, markdownContent);
    await writeFile(jsonFilePath, JSON.stringify(mail));

    // Check if there are attachments
    if (mail.attachments && mail.attachments.length > 0) {
      const zipStream = createWriteStream(zipFilePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.pipe(zipStream);

      // Append email content to zip archive
      // archive.append(mail.text, { name: `${sanitizedTitle}.md` });

      // Append attachments to zip archive
      for (const attachment of mail.attachments) {
        if(attachment && attachment.filename && attachment.content) {
          const fileNameParts = splitAtLastDot(attachment.filename);
          const sanitizedFilename = (await _sanitizeFilename(fileNameParts[0])) + (await _sanitizeFilename(fileNameParts[1]));
          archive.append(attachment.content, { name: sanitizedFilename });
        }
      }

      // Finalize the zip archive
      await archive.finalize();
    }
  } catch (e) {
    console.error(`Failed to save email: ${sanitizedTitle}`, e);
  }
}
