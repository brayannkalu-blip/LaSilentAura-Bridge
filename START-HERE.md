# La Silent Aura — Railway Ready

This package is arranged with the project files at the repository root.

Railway startup:
- Build: Dockerfile (or leave Build Command empty)
- Start: npm start

`npm start` runs `node bridge.mjs`.

Required Railway variables:
- TELEGRAM_BOT_TOKEN
- WHATSAPP_PHONE_NUMBER
- WHATSAPP_GROUP_ID (optional at first; can be discovered by the bridge)
- TELEGRAM_CHAT_ID (optional; discovered from the first Telegram message)
- BRIDGE_MODE=both

Do not upload this ZIP as a single file inside another repository. Extract it and upload the CONTENTS to the root of the GitHub repository, or upload the ZIP to a deployment system that extracts it before building.
