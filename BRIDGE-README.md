# La Silent Aura — Telegram ↔ WhatsApp Bridge

This package adds a separate bridge service to XYLO-MD. It uses the existing Baileys dependency and does not put your Telegram token into the source code.

## What it does

- Telegram → configured WhatsApp group
- WhatsApp group → configured Telegram chat
- Text forwarding
- Photos, videos, audio/voice and documents
- Persistent WhatsApp auth under `bridge_data/whatsapp-session`
- `.menu` in the configured WhatsApp group sends `data/menu.png` with La Silent Aura branding
- Pairing-code authentication on first run

## Setup

1. Copy `.env.bridge.example` to `.env`.
2. Put your Telegram BotFather token in `TELEGRAM_BOT_TOKEN`.
3. Put your Telegram chat ID in `TELEGRAM_CHAT_ID`.
4. Put your WhatsApp number in `WHATSAPP_PHONE_NUMBER` (digits only, country code included).
5. Start with `WHATSAPP_GROUP_ID` empty if you do not know the group JID.
6. Run `npm install` and then `npm run bridge`.
7. The console will print a WhatsApp pairing code. On the phone running the WhatsApp account: WhatsApp → Linked devices → Link with phone number.
8. After pairing, send one message in the target WhatsApp group. If `WHATSAPP_GROUP_ID` was empty, the console prints the group JID.
9. Put that JID into `WHATSAPP_GROUP_ID`, restart the bridge, and test from Telegram.

## Telegram group note

If the Telegram bot is added to a Telegram group and you want it to see ordinary group messages, disable BotFather privacy mode for the bot (`/setprivacy` → Disable). For a private one-to-one chat with the bot, this is not needed.

## Hosting note

The WhatsApp session directory must survive restarts. Hosts with ephemeral filesystems can force you to pair again after a restart/redeploy. For Render, use persistent storage if your plan supports it; the free service is not a reliable 24/7 WhatsApp host.

## Security

Never commit `.env`, your Telegram token, or `bridge_data/whatsapp-session` to GitHub.


## Render

This package includes `render.yaml` and a small HTTP health endpoint so it can run as a Render Web Service. The free service may sleep and its filesystem is not persistent, so WhatsApp pairing may need to be repeated after a restart/redeploy.
