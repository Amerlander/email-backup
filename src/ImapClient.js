import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

class ImapClient {
  #client

  constructor({ host, port, user, password }) {
    this.#client = new ImapFlow({
      host,
      port,
      secure: true,
      auth: {
        user,
        pass: password,
      },
      logger: false,
    })
  }

  async fetch(query) {
    await this.#client.connect()

     // Use listMailboxes method to get mailboxes
     const mailboxes = await this.#client.list();
     console.log('Mailboxes:', mailboxes.map(mailbox => mailbox.name).join(', '));

    
    const messages = []

    
    try {
      const fetchOptions = {
        source: true,
        headers: ['date', 'subject'],
        bodyStructure: true,

        flags: true,
        envelope: true,
        mailbox: true,
        uid: true,
      }

      for (const mailbox of mailboxes) {
        const lock = await this.#client.getMailboxLock(mailbox.name)
        await this.#client.mailboxOpen(mailbox.name);

        console.log(`Fetching emails from ${mailbox.name}...`);
        try {
          // const query = { since: sinceDate, ... };
          // const query = Object.keys(searchQuery).length ? searchQuery : { all: true }
          for await (const message of this.#client.fetch(query, fetchOptions)) {
            try{
              const mail = await simpleParser(message.source)
              const dateString = (mail.date) ? `${mail.date.toISOString().split('T')[0]} ${mail.date.toTimeString().split(' ')[0]}` : 'NO VALID DATE';
              // const subject = (mail.subject || 'No Subject')
              // console.log('READ EMAIL', mail)
              // const attachments = mail.attachments.map(attachment => ({
              //   filename: attachment.filename,
              //   content: attachment.content,
              // }))

              messages.push({
                dateString,
                mailbox,
                ...mail,
                source: message.source,
                // title,
                // text: `# ${title}\n${mail.text}`,
                // attachments,
              })
            } catch {
              console.log('ERROR PARSING EMAIL');
              console.log('MESSAGE', message);
              console.log('ERROR PARSING EMAIL');
            }
          }
        } finally {
          await lock.release()
        }
      }
    } finally {
      //
    }
    await this.#client.logout()
    return messages
  }
}

export { ImapClient }
