# baileys-channel-media-fix

**Send images, videos, audio and documents to WhatsApp Channels with Baileys.**

The official Baileys (`@whiskeysockets/baileys`) can't send media to channels (newsletters) properly:
- media arrives **gray / without a preview**, or doesn't render at all
- uploaded media is missing the `media_id` the channel stanza needs

This repo gives you a drop-in replacement: a Baileys fork with the fix ([PR #2836](https://github.com/WhiskeySockets/Baileys/pull/2836) to the official repo), plus a one-file interactive script to test it on your own channel.

## Install — one line

```sh
npm install "@whiskeysockets/baileys@git+https://github.com/meowguck-art/Baileys.git#fix-newsletter-media-attrs"
```

That's it. The package name stays `@whiskeysockets/baileys`, so **no code changes** — `require('@whiskeysockets/baileys')` keeps working, now with channel media that actually renders.

## Send media to a channel

```js
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

const { state, saveCreds } = await useMultiFileAuthState('./auth');
const sock = makeWASocket({ auth: state });
sock.ev.on('creds.update', saveCreds);

// images, videos, audio, documents — all work:
await sock.sendMessage('1203634XXXXXXXXX@newsletter', {
    image: { url: 'https://example.com/photo.jpg' },
    caption: 'hello channel'
});
```

Your channel's JID ends with `@newsletter`. The test script below can resolve it from an invite link.

## Test it yourself — one file

`test-channel-media.js` is a single interactive script. No env vars to set, no config files:

```sh
node test-channel-media.js
```

It asks you for:
1. your phone number (first run only — shows a pairing code)
2. your channel (invite link `whatsapp.com/channel/XXXX` or the full `@newsletter` JID)
3. a media file — local path **or** a direct URL (empty answer = plain text message, as a baseline)

Then it sends and waits 25 seconds so you can check the result on your phone. That check on a real phone is the only proof that matters.

Quick test URLs:
- image: `https://picsum.photos/600`
- video: `https://download.samplelib.com/mp4/sample-5s.mp4`

## What the fix does

1. Sets `mediatype` on the newsletter `<plaintext>` node
2. Carries the upload `handle` as `media_id` on the newsletter `<message>` stanza
3. Uploads through WhatsApp's dedicated **newsletter media endpoints** (`/newsletter/newsletter-image`, `-video`, `-document`, `-audio`) with server-side thumbnail generation — images and videos arrive **with previews**, not gray boxes
4. Fixes `ptvMessage` (video notes) classification and the newsletter media-cache bypass

Verified on a real phone: images render with preview, video plays.

## Status

This tracks [WhiskeySockets/Baileys#2836](https://github.com/WhiskeySockets/Baileys/pull/2836).
Once the PR is merged upstream, switch back to the official package:

```sh
npm install @whiskeysockets/baileys@latest
```

## License

MIT
