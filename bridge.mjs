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

        const msg = update?.message
        const text = msg?.text?.trim() || ''

        // Remember the Telegram chat that sent the command
        if (msg?.chat?.id) {
          const chatId = String(msg.chat.id)

          if (!telegramChatId) {
            telegramChatId = chatId
            console.log(
              `TELEGRAM_CHAT_ID discovered: ${telegramChatId}`
            )
          }

          if (telegramChatId !== chatId) {
            continue
          }
        }

        // ONE COMMAND: /pair
        if (text.toLowerCase() === '/pair') {
          if (!WHATSAPP_PHONE_NUMBER) {
            await sendTelegramText(
              '❌ WHATSAPP_PHONE_NUMBER is not configured.'
            )
            continue
          }

          await sendTelegramText(
            '⏳ Generating your WhatsApp pairing code...'
          )

          try {
            // Wait briefly if WhatsApp socket is still starting
            let attempts = 0

            while (!waSocket && attempts < 15) {
              await sleep(2000)
              attempts++
            }

            if (!waSocket) {
              throw new Error(
                'WhatsApp connection is not ready yet.'
              )
            }

            const code =
              await waSocket.requestPairingCode(
                WHATSAPP_PHONE_NUMBER
              )

            await sendTelegramText(
              `╭─『 𝓛𝓪 𝓢𝓲𝓵𝓮𝓷𝓽 𝓐𝓾𝓻𝓪 』─╮\n\n` +
              `🔐 WHATSAPP PAIRING CODE\n\n` +
              `📱 Number: ${WHATSAPP_PHONE_NUMBER}\n` +
              `🔑 Code: ${code}\n\n` +
              `Open WhatsApp → Linked devices →\n` +
              `Link with phone number → Enter this code.\n\n` +
              `╰────────────────────╯`
            )

            console.log(
              `WhatsApp pairing code generated: ${code}`
            )
          } catch (error) {
            console.error(
              'Pairing code error:',
              error?.message || error
            )

            await sendTelegramText(
              `❌ Could not generate pairing code.\n\n` +
              `${error?.message || error}\n\n` +
              `Make sure WhatsApp is not already linked to this session.`
            )
          }

          // Don't forward /pair to WhatsApp
          continue
        }

        // Normal Telegram → WhatsApp forwarding
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
