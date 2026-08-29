import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage,
} from 'baileys'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 10000)

http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('La Silent Aura bridge is running')
    return
  }

  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('La Silent Aura Telegram ↔ WhatsApp bridge')
}).listen(port, '0.0.0.0', () => {
  console.log(`Health server listening on ${port}`)
})

const DATA_DIR =
  process.env.BRIDGE_DATA_DIR ||
  path.join(__dirname, 'bridge_data')

const SESSION_DIR =
  process.env.WA_SESSION_DIR ||
  path.join(DATA_DIR, 'whatsapp-session')

const MENU_IMAGE = path.join(__dirname, 'data', 'menu.png')

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim()
let telegramChatId = (process.env.TELEGRAM_CHAT_ID || '').trim()

const WHATSAPP_GROUP_ID =
  (process.env.WHATSAPP_GROUP_ID || '').trim()

const WHATSAPP_PHONE_NUMBER =
  (process.env.WHATSAPP_PHONE_NUMBER || '').replace(/\D/g, '')

const BRIDGE_MODE =
  (process.env.BRIDGE_MODE || 'both').toLowerCase()

if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN')
  process.exit(1)
}

fs.mkdirSync(SESSION_DIR, { recursive: true })

const api = (method) =>
  `https://api.telegram.org/bot${TOKEN}/${method}`

let telegramOffset = 0
let waSocket = null
let reconnectTimer = null
let pairingPrinted = false
let pairingRequested = false

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function tg(method, body) {
  const response = await fetch(api(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await response.json()

  if (!data.ok) {
    throw new Error(
      `Telegram ${method}: ${
        data.description || 'request failed'
      }`
    )
  }

  return data.result
}

async function tgFile(fileId) {
  const file = await tg('getFile', { file_id: fileId })

  const response = await fetch(
    `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`
  )

  if (!response.ok) {
    throw new Error(
      `Telegram file download failed: ${response.status}`
    )
  }

  return Buffer.from(await response.arrayBuffer())
}

async function sendTelegramText(text) {
  if (!telegramChatId) return

  await tg('sendMessage', {
    chat_id: telegramChatId,
    text,
  })
}

async function sendTelegramMedia(
  kind,
  buffer,
  caption = '',
  filename = 'file.bin'
) {
  if (!telegramChatId) return

  const form = new FormData()

  form.append('chat_id', telegramChatId)

  if (caption) {
    form.append('caption', caption.slice(0, 1024))
  }

  const blob = new Blob([buffer])

  if (kind === 'photo') {
    form.append('photo', blob, filename)
  } else if (kind === 'video') {
    form.append('video', blob, filename)
  } else if (kind === 'audio') {
    form.append('audio', blob, filename)
  } else if (kind === 'voice') {
    form.append('voice', blob, filename)
  } else {
    form.append('document', blob, filename)
  }

  const method =
    kind === 'photo'
      ? 'sendPhoto'
      : kind === 'video'
        ? 'sendVideo'
        : kind === 'audio'
          ? 'sendAudio'
          : kind === 'voice'
            ? 'sendVoice'
            : 'sendDocument'

  const response = await fetch(api(method), {
    method: 'POST',
    body: form,
  })

  const data = await response.json()

  if (!data.ok) {
    throw new Error(
      `Telegram media: ${
        data.description || 'request failed'
      }`
    )
  }
}

function extractWaText(message) {
  const m = message?.message

  if (!m) return ''

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  )
}

function getWaKind(message) {
  const m = message?.message

  if (!m) return 'text'

  if (m.imageMessage) return 'photo'
  if (m.videoMessage) return 'video'

  if (m.audioMessage) {
    return m.audioMessage.ptt ? 'voice' : 'audio'
  }

  if (m.documentMessage) return 'document'

  return 'text'
}

function senderName(message) {
  return (
    message?.pushName ||
    message?.key?.participant?.split('@')[0] ||
    message?.key?.remoteJid?.split('@')[0] ||
    'WhatsApp'
  )
}

async function forwardWhatsAppToTelegram(message) {
  if (
    !telegramChatId ||
    BRIDGE_MODE === 'telegram_to_whatsapp'
  ) {
    return
  }

  const jid = message?.key?.remoteJid || ''

  if (WHATSAPP_GROUP_ID && jid !== WHATSAPP_GROUP_ID) {
    return
  }

  if (!jid.endsWith('@g.us')) return
  if (message?.key?.fromMe) return

  const text = extractWaText(message)
  const kind = getWaKind(message)
  const prefix = `*${senderName(message)}*`

  if (kind === 'text') {
    if (text) {
      await sendTelegramText(`${prefix}\n${text}`)
    }

    return
  }

  try {
    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      { logger: console }
    )

    const filename =
      message.message?.documentMessage?.fileName ||
      `${kind}-${Date.now()}`

    await sendTelegramMedia(
      kind,
      buffer,
      `${prefix}${text ? `\n${text}` : ''}`,
      filename
    )
  } catch (error) {
    console.error(
      'WhatsApp → Telegram media error:',
      error?.message || error
    )

    if (text) {
      await sendTelegramText(`${prefix}\n${text}`)
    }
  }
}

async function forwardTelegramToWhatsApp(update) {
  if (
    !waSocket ||
    !WHATSAPP_GROUP_ID ||
    BRIDGE_MODE === 'whatsapp_to_telegram'
  ) {
    return
  }

  const msg = update?.message

  if (!msg) return

  if (!telegramChatId) {
    telegramChatId = String(msg.chat.id)

    console.log(
      `TELEGRAM_CHAT_ID discovered: ${telegramChatId}`
    )
  } else if (String(msg.chat.id) !== telegramChatId) {
    return
  }

  const caption = msg.caption || ''

  if (msg.text) {
    await waSocket.sendMessage(
      WHATSAPP_GROUP_ID,
      {
        text:
          `╭─『 𝓛𝓪 𝓢𝓲𝓵𝓮𝓷𝓽 𝓐𝓾𝓻𝓪 』─╮\n` +
          `${msg.text}\n` +
          `╰────────────────────╯`,
      }
    )

    return
  }

  try {
    if (msg.photo?.length) {
      const fileId =
        msg.photo[msg.photo.length - 1].file_id

      const buffer = await tgFile(fileId)

      await waSocket.sendMessage(
        WHATSAPP_GROUP_ID,
        {
          image: buffer,
          caption,
        }
      )

      return
    }

    if (msg.video) {
      const buffer = await tgFile(msg.video.file_id)

      await waSocket.sendMessage(
        WHATSAPP_GROUP_ID,
        {
          video: buffer,
          caption,
          mimetype:
            msg.video.mime_type || 'video/mp4',
        }
      )

      return
    }

    if (msg.audio) {
      const buffer = await tgFile(msg.audio.file_id)

      await waSocket.sendMessage(
        WHATSAPP_GROUP_ID,
        {
          audio: buffer,
          mimetype:
            msg.audio.mime_type || 'audio/mpeg',
          ptt: false,
        }
      )

      return
    }

    if (msg.voice) {
      const buffer = await tgFile(msg.voice.file_id)

      await waSocket.sendMessage(
        WHATSAPP_GROUP_ID,
        {
          audio: buffer,
          mimetype:
            msg.voice.mime_type ||
            'audio/ogg; codecs=opus',
          ptt: true,
        }
      )

      return
    }

    if (msg.document) {
      const buffer =
        await tgFile(msg.document.file_id)

      await waSocket.sendMessage(
        WHATSAPP_GROUP_ID,
        {
          document: buffer,
          fileName:
            msg.document.file_name ||
            'document',
          mimetype:
            msg.document.mime_type ||
            'application/octet-stream',
          caption,
        }
      )
    }
  } catch (error) {
    console.error(
      'Telegram → WhatsApp media error:',
      error?.message || error
    )
  }
}

async function telegramLoop() {
  console.log('Telegram bridge polling started')

  while (true) {
    try {
      const updates = await tg('getUpdates', {
        offset: telegramOffset,
        timeout: 25,
        allowed_updates: ['message'],
      })

      for (const update of updates) {
        telegramOffset = update.update_id + 1

        await forwardTelegramToWhatsApp(update)
      }
    } catch (error) {
      console.error(
        'Telegram polling error:',
        error?.message || error
      )

      await sleep(3000)
    }
  }
}

async function startWhatsApp() {
  const {
    state,
    saveCreds,
  } = await useMultiFileAuthState(SESSION_DIR)

  const { version } =
    await fetchLatestBaileysVersion().catch(() => ({
      version: undefined,
    }))

  waSocket = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    browser: Browsers.ubuntu(
      'La Silent Aura Bridge'
    ),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
  })

  waSocket.ev.on(
    'creds.update',
    saveCreds
  )

  waSocket.ev.on(
    'connection.update',
    async ({
      connection,
      lastDisconnect,
    }) => {

      /*
       * PAIRING FIX
       *
       * We wait for the WhatsApp connection to start
       * before asking for the pairing code.
       * The request is delayed slightly so the socket
       * has time to become ready.
       */

      if (
        connection === 'connecting' &&
        !state.creds.registered &&
        WHATSAPP_PHONE_NUMBER &&
        !pairingRequested
      ) {
        pairingRequested = true

        console.log(
          'WhatsApp connection starting — preparing pairing code...'
        )

        await sleep(4000)

        try {
          const code =
            await waSocket.requestPairingCode(
              WHATSAPP_PHONE_NUMBER
            )

          pairingPrinted = true

          console.log(
            `\nPAIRING CODE: ${code}\n`
          )

          console.log(
            'Open WhatsApp → Linked devices → Link with phone number → enter this code.'
          )

        } catch (error) {
          pairingRequested = false
          pairingPrinted = false

          console.error(
            'Could not create pairing code:',
            error?.message || error
          )
        }
      }

      if (connection === 'open') {
        pairingPrinted = false

        console.log(
          'WhatsApp connected ✓'
        )

        if (WHATSAPP_GROUP_ID) {
          console.log(
            `WhatsApp target group: ${WHATSAPP_GROUP_ID}`
          )
        } else {
          console.log(
            'WHATSAPP_GROUP_ID is empty — send a message in your target group to discover its JID.'
          )
        }
      }

      if (connection === 'close') {
        const code =
          lastDisconnect?.error?.output?.statusCode

        console.log(
          `WhatsApp disconnected (${code ?? 'unknown'})`
        )

        if (
          code !== DisconnectReason.loggedOut
        ) {
          pairingRequested = false

          clearTimeout(reconnectTimer)

          reconnectTimer = setTimeout(
            () =>
              startWhatsApp().catch(
                console.error
              ),
            5000
          )
        } else {
          console.error(
            'WhatsApp session logged out. Delete bridge_data/whatsapp-session and pair again.'
          )
        }
      }
    }
  )

  waSocket.ev.on(
    'messages.upsert',
    async ({ messages }) => {
      for (
        const message of messages || []
      ) {
        if (!message?.message) continue

        const jid =
          message.key?.remoteJid || ''

        const text =
          extractWaText(message)
            .trim()
            .toLowerCase()

        if (
          jid.endsWith('@g.us') &&
          text === '.menu' &&
          !message.key?.fromMe &&
          WHATSAPP_GROUP_ID &&
          jid === WHATSAPP_GROUP_ID
        ) {
          try {
            if (
              fs.existsSync(MENU_IMAGE)
            ) {
              await waSocket.sendMessage(
                jid,
                {
                  image:
                    fs.readFileSync(
                      MENU_IMAGE
                    ),
                  caption:
                    '╰┈➤ 𓆩⟡『 𝓛𝓪 𝓢𝓲𝓵𝓮𝓷𝓽 𝓐𝓾𝓻𝓪 』⟡𓆪\n\n' +
                    '𝑷𝑹𝑬𝑴𝑰𝑼𝑴 𝑴𝑼𝑳𝑻𝑰 𝑫𝑬𝑽𝑰𝑪𝑬',
                }
              )
            } else {
              await waSocket.sendMessage(
                jid,
                {
                  text:
                    '╰┈➤ 𓆩⟡『 𝓛𝓪 𝓢𝓲𝓵𝓮𝓷𝓽 𝓐𝓾𝓻𝓪 』⟡𓆪',
                }
              )
            }
          } catch (error) {
            console.error(
              '.menu error:',
              error?.message || error
            )
          }
        }

        await forwardWhatsAppToTelegram(
          message
        ).catch(
          (error) =>
            console.error(
              'WA → TG error:',
              error?.message || error
            )
        )

        if (
          jid.endsWith('@g.us') &&
          !WHATSAPP_GROUP_ID
        ) {
          console.log(
            `DISCOVERED WHATSAPP GROUP: ${jid}`
          )
        }
      }
    }
  )
}

console.log(
  '╭────────────────────────────────────────────╮'
)

console.log(
  '│  𝓛𝓪 𝓢𝓲𝓵𝓮𝓷𝓽 𝓐𝓾𝓻𝓪 — Telegram ↔ WhatsApp  │'
)

console.log(
  '╰────────────────────────────────────────────╯'
)

console.log(
  `Bridge mode: ${BRIDGE_MODE}`
)

console.log(
  `Telegram chat: ${
    telegramChatId ||
    'AUTO (first incoming chat)'
  }`
)

await Promise.all([
  startWhatsApp(),
  telegramLoop(),
])
