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
    const lock = await this.#client.getMailboxLock('INBOX')
    const messages = []
    try {
      const fetchOptions = {
        source: true,
        headers: ['date', 'subject'],
        bodyStructure: true,
      }

      // const query = { since: sinceDate, ... };
      // const query = Object.keys(searchQuery).length ? searchQuery : { all: true }
      for await (const message of this.#client.fetch(query, fetchOptions)) {
        
        const mail = await simpleParser(message.source)
        // console.log(mail)
        const dateString = (mail.date) ? `${mail.date.toISOString().split('T')[0]} ${mail.date.toTimeString().split(' ')[0]}` : 'NO VALID DATE';
        // const subject = (mail.subject || 'No Subject')
        // console.log('READ EMAIL', title)
        // const attachments = mail.attachments.map(attachment => ({
        //   filename: attachment.filename,
        //   content: attachment.content,
        // }))

        messages.push({
          dateString,
          ...mail,
          // title,
          // text: `# ${title}\n${mail.text}`,
          // attachments,
        })
      }
    } finally {
      await lock.release()
    }
    await this.#client.logout()
    return messages
  }
}

export { ImapClient }
