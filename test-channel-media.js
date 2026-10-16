// ============================================================================
// test-channel-media.js — test the channel media fix (one interactive file)
//
// Run from your bot folder (after installing the fixed Baileys):
//   node test-channel-media.js
//
// The script asks you everything: phone (first pairing only), channel
// (invite link or JID), and a media file (empty = text message).
// No env vars to type before running.
// ============================================================================

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');

let pino;
try {
    pino = require('pino');
} catch {
    pino = () => ({
        level: 'silent',
        child() { return this; },
        trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}
    });
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Download a URL to a file (curl or wget)
function downloadUrl(url, dest) {
    return new Promise((resolve) => {
        execFile('curl', ['-fsSL', '--max-time', 90, '-o', dest, url], (err) => {
            if (!err) return resolve(true);
            execFile('wget', ['-q', '-O', dest, url], (err2) => resolve(!err2));
        });
    });
}

// Detect media kind by magic bytes (never trusts extension/URL)
function detectMediaKind(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const head = Buffer.alloc(12);
        fs.readSync(fd, head, 0, 12, 0);
        fs.closeSync(fd);
        if (head[0] === 0xff && head[1] === 0xd8) return 'image'; // JPEG
        if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image'; // PNG
        if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image'; // GIF
        if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'image';
        if (head.toString('ascii', 4, 8) === 'ftyp') return 'video'; // MP4
        if (head.toString('ascii', 0, 4) === 'OggS') return 'audio'; // OGG
    } catch { /* ignore */ }
    return null;
}

async function main() {
    // 0. Make sure the fixed Baileys is installed
    try {
        const mmPath = require.resolve('@whiskeysockets/baileys/lib/Utils/messages-media.js');
        if (!fs.readFileSync(mmPath, 'utf8').includes('server_thumb_gen')) {
            console.error('The channel-media fix is not installed on this Baileys.');
            console.error('Run: npm install "@whiskeysockets/baileys@git+https://github.com/meowguck-art/Baileys.git#fix-newsletter-media-attrs"');
            process.exit(1);
        }
    } catch {
        console.error('No @whiskeysockets/baileys installed in this folder.');
        process.exit(1);
    }

    // 1. Connect (pair once, saved in channel-test-auth)
    let phone = (process.env.PHONE || '').replace(/\D/g, '');
    const { state, saveCreds } = await useMultiFileAuthState('./channel-test-auth');
    const sock = makeWASocket({ auth: state, logger: pino({ level: 'error' }) });
    sock.ev.on('creds.update', saveCreds);

    let connected = false;
    let loggedOut = false;
    sock.ev.on('connection.update', (u) => {
        if (u.connection === 'open') connected = true;
        if (u.connection === 'close' && u.lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
            loggedOut = true;
        }
    });

    if (!state.creds.registered) {
        if (!phone) phone = (await ask('Phone number (9725XXXXXXXX): ')).replace(/\D/g, '');
        await delay(3500); // let the socket start connecting, otherwise 428
        const code = await sock.requestPairingCode(phone);
        console.log('Pairing code (WhatsApp > Linked devices > Link a device):', code);
    }
    while (!connected && !loggedOut) await delay(500);
    if (loggedOut) {
        console.error('Session was logged out. Delete channel-test-auth and try again.');
        process.exit(1);
    }
    console.log('Connected.');

    // 2. Channel — invite link, code, or JID (asks again if lookup fails)
    let channelJid = process.env.CHANNEL || '';
    while (!channelJid) {
        const input = await ask('Channel: paste invite link (whatsapp.com/channel/XXXX) or full JID: ');
        if (input.endsWith('@newsletter')) {
            channelJid = input;
            break;
        }
        const m = input.match(/channel\/([A-Za-z0-9]+)/) || input.match(/^([A-Za-z0-9]{10,})$/) || [null, input.trim()];
        const code = m[1];
        console.log('Looking up the channel...');
        try {
            const meta = await sock.newsletterMetadata('invite', code);
            if (meta && meta.id) {
                channelJid = meta.id.includes('@') ? meta.id : `${meta.id}@newsletter`;
                console.log('Found:', meta.name || '(no name)', '|', channelJid);
            } else {
                console.log('Could not resolve automatically. Paste the full JID (ends with @newsletter).');
            }
        } catch {
            console.log('Lookup failed. Paste the full JID (ends with @newsletter).');
        }
    }

    // 3. Media — local file, direct link, or empty for text
    let content;
    const cliFile = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
    let mediaInput = cliFile || '';
    if (!mediaInput) mediaInput = await ask('Media to test: file path, direct image/video link, or empty = text message: ');
    if (!mediaInput) {
        content = { text: `channel test (text) ${new Date().toISOString()}` };
        console.log('Sending text message...');
    } else {
        let mediaFile = mediaInput;
        let kind = null;
        if (/^https?:\/\//i.test(mediaInput)) {
            console.log('Downloading the file...');
            const tmpFile = './.test-media-download';
            const ok = await downloadUrl(mediaInput, tmpFile);
            if (!ok || !fs.existsSync(tmpFile)) {
                console.error('Download failed. Check the link.');
                process.exit(1);
            }
            kind = detectMediaKind(tmpFile);
            if (!kind) {
                try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
                console.error('The link did not return a media file — probably a web page, not a direct image.');
                console.error('Tip: long-press the image > Copy image address.');
                process.exit(1);
            }
            mediaFile = tmpFile;
        }
        if (!fs.existsSync(mediaFile)) {
            console.error('File not found:', mediaFile);
            process.exit(1);
        }
        if (!kind) {
            const ext = path.extname(mediaFile).toLowerCase();
            if (['.ogg', '.opus'].includes(ext)) kind = 'audio';
            else if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) kind = 'image';
            else if (ext === '.mp4') kind = 'video';
            else {
                console.error('Unsupported extension:', ext);
                process.exit(1);
            }
        }
        const buf = fs.readFileSync(mediaFile);
        if (kind === 'audio') {
            const pttAns = (await ask('Send as voice message? (y/n): ')).toLowerCase();
            const ptt = pttAns.startsWith('y');
            content = { audio: buf, mimetype: 'audio/ogg; codecs=opus', ptt: ptt || undefined };
            console.log(ptt ? 'Sending voice message...' : 'Sending audio...');
        } else if (kind === 'image') {
            content = { image: buf, caption: 'channel image test' };
            console.log('Sending image...');
        } else {
            content = { video: buf, caption: 'channel video test' };
            console.log('Sending video...');
        }
    }

    try {
        const res = await sock.sendMessage(channelJid, content);
        console.log('Sent without a send error. id:', res?.key?.id);
    } catch (e) {
        console.error('Send error:', e.message);
        process.exit(1);
    }

    console.log('Waiting 25 seconds... check your phone: did the message reach the channel?');
    await delay(25000);
    rl.close();
    process.exit(0);
}

main().catch((e) => {
    console.error('Error:', e.message || e);
    process.exit(1);
});
