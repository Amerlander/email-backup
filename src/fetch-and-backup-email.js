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

export async function fetchAndBackupEmail({ imapConfig, searchQuery, output }) {
  const client = new ImapClient(imapConfig)
  const messages = await client.fetch(searchQuery)
  const countMessages = messages.length;
  for (const [index, message] of messages.entries()) {
    console.log(`Processing ${index+1}/${countMessages} | ${message.dateString} | ${message.subject}`)
    await _saveIfNotExist(message, output)
  }
  console.log("=== FINISHED ===")
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
          console.error(`Failed to read local image: ${src}`);
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
      console.error(`Failed to convert HTML body to DOM. Falling back to text as HTML.`)
    const turndownService = new Turndown();
    markdownBody = turndownService.turndown(email.textAsHtml);
    } catch {
      console.error(`Failed to convert HTML body to Markdown using Turndown. Falling back to plain text.`)
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


async function _saveIfNotExist(mail, output) {
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


  try {
    // Create folder if it doesn't exist
    
    // Ensure the save path exists
    try {
      await access(absoluteFolderPath, constants.F_OK);
      console.log(`Folder ${absoluteFolderPath} already exists.`);
      return;
    } catch {
      await mkdir(absoluteFolderPath, { recursive: true });
    }

    // Write email content to .md file
    const markdownContent = await convertEmailToMarkdown(mail, `${absoluteFolderPath}/assets`);
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
          const sanitizedFilename = (await _sanitizeFilename(fileNameParts[0])) + '.' + (await _sanitizeFilename(fileNameParts[1]));
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
