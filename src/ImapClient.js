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

  async *fetch(query) {
    await this.#client.connect()

    const mailboxes = await this.#client.list();
    console.log('Mailboxes:', mailboxes.map(mailbox => mailbox.name).join(', '));

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
          // Perform a fast search first to get the accurate count
          const searchList = await this.#client.search(query);
          if (searchList.length > 0) {
            yield { type: 'count', mailbox: mailbox.name, count: searchList.length };
          } else {
            yield { type: 'count', mailbox: mailbox.name, count: 0 };
            continue;
          }

          // Use search list instead of raw query string, or just yield via search sequence
          for await (const message of this.#client.fetch(searchList, fetchOptions)) {
             try {
              const mail = await simpleParser(message.source)
              const dateString = (mail.date) ? `${mail.date.toISOString().split('T')[0]} ${mail.date.toTimeString().split(' ')[0]}` : 'NO VALID DATE';
              
              yield { type: 'message', data: {
                dateString,
                mailbox,
                ...mail,
                source: message.source,
              }};
             } catch {
               console.log('ERROR PARSING EMAIL');
             }
          }
        } finally {
          await lock.release()
        }
      }
    } finally {
      await this.#client.logout()
    }
  }

  async deleteMessages(query) {
    await this.#client.connect()
    const mailboxes = await this.#client.list();
    
    let totalDeleted = 0;
    
    try {
      for (const mailbox of mailboxes) {
        const lock = await this.#client.getMailboxLock(mailbox.name)
        await this.#client.mailboxOpen(mailbox.name);
        
        try {
          const list = await this.#client.search(query);
          if(list.length > 0) {
            await this.#client.messageDelete(list);
            totalDeleted += list.length;
          }
        } finally {
          await lock.release()
        }
      }
    } finally {
      await this.#client.logout()
    }
    
    return totalDeleted;
  }
}

export { ImapClient }
