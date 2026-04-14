import { access, constants, writeFile, mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { ImapClient } from './ImapClient.js'
import archiver from 'archiver'
import { createWriteStream } from 'node:fs'
import Turndown from 'turndown';
import { JSDOM } from 'jsdom';
import path from 'path';
import axios from 'axios';
import { URL } from 'url';
import clc from 'cli-color';

export async function fetchAndBackupEmail({ imapConfig, searchQuery, output, eventEmitter, abortSignal, deleteOlderThan }) {
  const client = new ImapClient(imapConfig)
  if (eventEmitter) eventEmitter.emit('log', 'Connecting to IMAP and searching messages...');
  
  await client.connect();
  
  let totalMessages = 0;
  let processedMessages = 0;
  const uidsToDeleteByMailbox = {};
  const mailboxStats = {}; // { 'INBOX': { found: 0, saved: 0, deleted: 0 } }

  try {
    for await (const chunk of client.fetch(searchQuery)) {
      if (abortSignal?.aborted) {
        console.log(clc.yellow("=== ABORTED ==="));
        if (eventEmitter) eventEmitter.emit('log', "=== ABORTED ===");
        return;
      }
      
      if (chunk.type === 'count') {
        const mbox = chunk.mailbox;
        if (!mailboxStats[mbox]) mailboxStats[mbox] = { found: 0, saved: 0, deleted: 0 };
        mailboxStats[mbox].found += chunk.count;
        totalMessages += chunk.count;
        if (eventEmitter) eventEmitter.emit('mailbox_stats', { mailbox: mbox, stats: mailboxStats[mbox] });
        if (eventEmitter) eventEmitter.emit('log', `Found ${chunk.count} messages in ${mbox}.`);
      } else if (chunk.type === 'message') {
        processedMessages++;
        const message = chunk.data;
        const mbox = message.mailbox.name;
        if (!mailboxStats[mbox]) mailboxStats[mbox] = { found: 0, saved: 0, deleted: 0 };

        const logMsg = `Processing ${processedMessages}/${totalMessages} | ${mbox}`;
        console.log(logMsg);
        if (eventEmitter) eventEmitter.emit('progress', { index: processedMessages, total: totalMessages, logMsg });
        const savedSuccessfully = await _saveIfNotExist(message, output, eventEmitter);

        if (savedSuccessfully) {
           mailboxStats[mbox].saved++;
           if (eventEmitter) eventEmitter.emit('mailbox_stats', { mailbox: mbox, stats: mailboxStats[mbox] });
           
           if (deleteOlderThan && new Date(message.date) < new Date(deleteOlderThan)) {
               if (!uidsToDeleteByMailbox[mbox]) uidsToDeleteByMailbox[mbox] = [];
               if (message.uid) uidsToDeleteByMailbox[mbox].push(message.uid);
           }
        }
      }
    }

    console.log(clc.green("=== FINISHED FETCHING ==="))
    if (eventEmitter) eventEmitter.emit('log', "=== FINISHED FETCHING ===");
    
    if (deleteOlderThan && !abortSignal?.aborted) {
      if (eventEmitter) eventEmitter.emit('log', `Starting precise deletion of safely backed up messages older than ${deleteOlderThan}...`);
      try {
        let totalDeleted = 0;
        for (const [mailboxName, uids] of Object.entries(uidsToDeleteByMailbox)) {
           if (uids.length > 0) {
             const deletedCount = await client.deleteMessagesByUid(mailboxName, uids);
             totalDeleted += deletedCount;
             mailboxStats[mailboxName].deleted += deletedCount;
             if (eventEmitter) eventEmitter.emit('mailbox_stats', { mailbox: mailboxName, stats: mailboxStats[mailboxName] });
             if (eventEmitter) eventEmitter.emit('log', `Permanently deleted ${deletedCount} messages from ${mailboxName}.`);
           }
        }
        if (eventEmitter) eventEmitter.emit('log', `Deletion complete: ${totalDeleted} older messages removed.`);
      } catch(err) {
        if (eventEmitter) eventEmitter.emit('log', `Error during precise deletion: ${err.message}`);
      }
    }
  } finally {
    try {
      await client.logout();
    } catch (e) {
      // Ignored
    }
    if (eventEmitter) eventEmitter.emit('finished');
  }
}

async function _sanitizeFilename(filename) {
  // Replace special characters with underscores
  if(filename && filename.length) {
  return filename
            .replace(/\./g, '+')
            .replace(/@/g, 'AT')
            .replace(/\s/g, '_')
            .replace(/[^0-9a-zA-Z+_]/g, '-').trim();
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

async function convertEmailToMarkdown(email, savePath) {
  // Ensure the save path exists
  try {
    await access(savePath, constants.F_OK);
  } catch {
    await mkdir(savePath, { recursive: true });
  }

  // Extract metadata
  const mailbox = email.mailbox?.name || 'Unknown Mailbox';
  const from = email.from?.text || 'Unknown Sender';
  const to = email.to?.text || 'Unknown Receiver';
  const subject = email.subject || 'No Subject';
  const date = email.dateString || new Date().toString();
  const attachments = email.attachments.map(att => `[${att.name}](${att.cid})`).join(', ');
  const spamState = `# Spam: ${email.headers.get('x-spam')}: ${email.headers.get('x-spam-level')}`;
  let markdownBody = email.text;

  try {
      
    // Convert HTML to DOM
    const htmlContent = email.html || email.textAsHtml || email.text;
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;

    // Remove CSS
    Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).forEach(element => element.remove());

    // Save images and update their src attributes
    const images = Array.from(document.querySelectorAll('img'));
    let imageCounter = 1;
    for (let img of images) {
      const src = img.getAttribute('src');

      if (src.startsWith('data:image/')) {
        // If the src is already a base64-encoded image, do nothing
        continue;
      }

      let imgData, imgExt;
      if (src.startsWith('http') || src.startsWith('www') || isValidUrl(src)) {
        const response = await axios.get(src, { responseType: 'arraybuffer' });
        imgData = Buffer.from(response.data);
        imgExt = path.extname(new URL(src).pathname).slice(1) || 'jpg';
      } else {
        try {
          const filePath = path.resolve(src);
          imgData = await readFile(filePath);
          imgExt = path.extname(src).slice(1) || 'jpg';
        } catch (err) {
          console.error(clc.magenta(`Failed to read local image: ${src}`));
          imgData = null;
          imgExt = 'jpg'; // Fallback in case of error
          continue;
        }
      }

      if (imgData) {
        const imageName = `${imageCounter}.${imgExt}`;
        const imagePath = path.join(savePath, imageName);
        await writeFile(imagePath, imgData);
        img.setAttribute('src', `./assets/${imageName}`);
        imageCounter++;
      }
    }


    // Convert HTML body to Markdown using Turndown
    const turndownService = new Turndown();
    markdownBody = turndownService.turndown(document.body.innerHTML);
  
  } catch {
    try {
      console.error(clc.yellow(`Failed to convert HTML body to DOM. Falling back to text as HTML.`))
    const turndownService = new Turndown();
    markdownBody = turndownService.turndown(email.textAsHtml);
    } catch {
      console.error(clc.yellowBright(`Failed to convert HTML body to Markdown using Turndown. Falling back to plain text.`))
    }
  }

  // Construct Markdown content
  const markdownContent = `${(email.headers.get('x-spam-level') || email.headers.get('x-spam')) ? spamState : ''}
  
### Email Metadata:
- **Mailbox:** ${mailbox}
- **From:** ${from}
- **To:** ${to}
- **Subject:** ${subject}
- **Date:** ${date}
- **Attachments:** ${attachments || 'None'}

### Email Body:

${markdownBody}`;

  return markdownContent;
}


function isValidUrl(urlString) {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}


async function _saveIfNotExist(mail, output, eventEmitter) {
  const sanitizedSubject = (await _sanitizeFilename(mail.subject)).substring(0, 25);
  const sanitizedFrom = mail.from?.value[0].address ? await _sanitizeFilename(mail.from?.value[0].address) : 'NO-FROM';
  // const sanitizedSMessageID = (await _sanitizeFilename(mail.messageId)).substring(0, 10);
  const sanitizeDateString = await _sanitizeFilename(mail.dateString);
  const sanitizedTitle = `${sanitizeDateString}${(mail.headers.get('x-spam') || mail.headers.get('x-spam-level')?.length > 2) ? ' _SPAM_ ' : ''} ${sanitizedFrom} ${sanitizedSubject}`;

  const folderPath = join(output, (mail.mailbox.path ?? 'Undefined'), sanitizedTitle);
  const absoluteFolderPath = isAbsolute(output) ? folderPath : resolve(folderPath);
  const mdFilePath = `${absoluteFolderPath}/${sanitizedTitle}.md`;
  const zipFilePath = `${absoluteFolderPath}/${sanitizedTitle}.zip`;
  const jsonFilePath = `${absoluteFolderPath}/${sanitizedTitle}.json`;
  const emlFilePath = `${absoluteFolderPath}/${sanitizedTitle}.eml`;


  try {
    // Create folder if it doesn't exist
    
    // Ensure the save path exists
    try {
      await access(absoluteFolderPath, constants.F_OK);
      const skipMsg = `Skipped: Folder already exists | ${absoluteFolderPath}`;
      console.log(clc.blue(skipMsg));
      // if (eventEmitter) eventEmitter.emit('log', skipMsg); // We don't want to spam the log for skipped emails, but we return true
      return true;
    } catch {
      await mkdir(absoluteFolderPath, { recursive: true });
    
      // Write email content to .md file
      const markdownContent = await convertEmailToMarkdown(mail, `${absoluteFolderPath}/assets`);
      await writeFile(mdFilePath, markdownContent);
      // await writeFile(jsonFilePath, JSON.stringify(mail));
      await writeFile(emlFilePath, mail.source);
      if (eventEmitter) eventEmitter.emit('log', `Saved: ${absoluteFolderPath}`);

      // Check if there are attachments
      if (mail.attachments && mail.attachments.length > 0) {
        const zipStream = createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.pipe(zipStream);

        // Append attachments to zip archive
        for (const attachment of mail.attachments) {
          if(attachment && attachment.filename && attachment.content) {
            const fileNameParts = splitAtLastDot(attachment.filename);
            const sanitizedFilename = (await _sanitizeFilename(fileNameParts[0])) + '.' + (await _sanitizeFilename(fileNameParts[1]));
            archive.append(attachment.content, { name: sanitizedFilename });
          }
        }

        // Finalize the zip archive
        await archive.finalize();
      }
    }
    return true;
  } catch (e) {
    console.error(clc.redBright(`Failed to save email: ${sanitizedTitle}`), e);
    return false;
  }
}
