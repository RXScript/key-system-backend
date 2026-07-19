require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(express.json());
app.use(helmet());

// =================== CONFIGURATION ===================
const GITHUB_PAGES_URL = process.env.GITHUB_PAGES_URL || "https://rxscript.github.io/";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://rxscript.github.io";

const LINKVERTISE_USER_ID = process.env.LINKVERTISE_USER_ID || "7599156";
const LOOTLABS_CP1 = process.env.LOOTLABS_CP1 || "https://loot-link.com/s?yKatk89I&url=";
const LOOTLABS_CP2 = process.env.LOOTLABS_CP2 || "https://loot-link.com/s?yKatk89I&url=";
const WORKINK_URL = process.env.WORKINK_URL || "https://work.ink/2KRk/key-system?url=";

const HWID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/; // adjust to match whatever format the Roblox script actually sends
const API_SECRET = process.env.API_SECRET || ""; // set this in Render's env vars; leave unset to disable the check
// =====================================================

// Requires the caller to send x-api-key matching API_SECRET.
// This does NOT stop someone who reads the script and copies the key out —
// it only stops casual poking from Postman/browser console.
function requireApiKey(req, res, next) {
    if (!API_SECRET) return next(); // disabled if no secret configured
    const provided = req.get('x-api-key');
    if (provided !== API_SECRET) {
        return res.status(401).json({ error: "Unauthorized." });
    }
    next();
}

app.use(cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST"]
}));

// Rate limit: applies to all routes. Tune per-route if one endpoint needs to be stricter.
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,             // 30 requests per IP per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, slow down." }
});
app.use(limiter);

const activeTokens = new Map();
const userProgress = new Map();
const generatedKeys = new Map();
const completedTokens = new Map();
const activeUserKeys = new Map();

const encodeBase64 = (text) => Buffer.from(text).toString('base64');

const isValidHwid = (hwid) => typeof hwid === 'string' && HWID_REGEX.test(hwid);

const generateAdLink = (destination, provider, step) => {
    if (provider === 'linkvertise') {
        return `https://link-to.net/${LINKVERTISE_USER_ID}/${Math.floor(Math.random() * 99999)}/dynamic?r=${encodeBase64(destination)}`;
    }
    else if (provider === 'workink') {
        return `${WORKINK_URL}${encodeURIComponent(destination)}`;
    }
    else if (provider === 'lootlabs') {
        return step === 1
            ? `${LOOTLABS_CP1}${encodeURIComponent(destination)}`
            : `${LOOTLABS_CP2}${encodeURIComponent(destination)}`;
    }
    return destination;
};

// =================== CLEANUP SWEEP ===================
// Maps never shrink on their own — this evicts anything past its expiry
// so long-running free-tier instances don't slowly leak memory.
function cleanupExpired() {
    const now = Date.now();

    for (const [token, data] of activeTokens) {
        if (now > data.expires) activeTokens.delete(token);
    }
    for (const [token, data] of completedTokens) {
        if (now > data.expires) completedTokens.delete(token);
    }
    for (const [key, data] of generatedKeys) {
        if (now > data.expires) {
            generatedKeys.delete(key);
            // Also clear the hwid -> key mapping if it points at this now-dead key
            for (const [hwid, mappedKey] of activeUserKeys) {
                if (mappedKey === key) activeUserKeys.delete(hwid);
            }
        }
    }
}
setInterval(cleanupExpired, 10 * 60 * 1000); // every 10 minutes
// =====================================================

app.get('/get-link', requireApiKey, (req, res) => {
    const { hwid, provider } = req.query;

    if (!hwid) return res.status(400).json({ error: "Missing HWID" });
    if (!isValidHwid(hwid)) return res.status(400).json({ error: "Invalid HWID format" });

    const existingKey = activeUserKeys.get(hwid);
    if (existingKey) {
        const keyData = generatedKeys.get(existingKey);
        if (keyData && Date.now() < keyData.expires) {
            const bypassToken = crypto.randomBytes(16).toString('hex');
            completedTokens.set(bypassToken, { key: existingKey, expires: keyData.expires });
            return res.json({
                status: "checkpoint",
                link: `${GITHUB_PAGES_URL}?token=${bypassToken}`,
                currentStep: 2
            });
        }
    }

    const safeProvider = ['linkvertise', 'workink', 'lootlabs'].includes(provider) ? provider : 'linkvertise';
    const completed = userProgress.get(hwid) || 0;
    const token = crypto.randomBytes(16).toString('hex');
    const step = completed + 1;

    activeTokens.set(token, { hwid, step, provider: safeProvider, expires: Date.now() + 600000 });

    const destination = `${GITHUB_PAGES_URL}?token=${token}`;
    res.json({ status: "checkpoint", link: generateAdLink(destination, safeProvider, step), currentStep: step });
});

app.post('/verify-token', (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
        return res.status(400).json({ success: false, message: "Missing token." });
    }

    if (completedTokens.has(token)) {
        const data = completedTokens.get(token);
        if (Date.now() < data.expires) {
            return res.json({ success: true, completedAll: true, key: data.key, expires: data.expires });
        }
        completedTokens.delete(token);
    }

    const tokenData = activeTokens.get(token);
    if (!tokenData || Date.now() > tokenData.expires) {
        return res.status(400).json({ success: false, message: "Invalid or expired token." });
    }

    const { hwid, step, provider } = tokenData;
    const currentCompleted = userProgress.get(hwid) || 0;

    if (step === 1 && currentCompleted === 0) {
        userProgress.set(hwid, 1);
        activeTokens.delete(token);

        const nextToken = crypto.randomBytes(16).toString('hex');
        activeTokens.set(nextToken, { hwid, step: 2, provider, expires: Date.now() + 600000 });

        const destination = `${GITHUB_PAGES_URL}?token=${nextToken}`;
        return res.json({ success: true, completedAll: false, nextLink: generateAdLink(destination, provider, 2) });
    }

    if (step === 2 && currentCompleted === 1) {
        userProgress.delete(hwid);
        activeTokens.delete(token);

        const finalKey = "RX-" + crypto.randomBytes(8).toString('hex'); // 64 bits instead of 32
        const expireTime = Date.now() + 16 * 60 * 60 * 1000;

        generatedKeys.set(finalKey, { hwid, expires: expireTime });
        activeUserKeys.set(hwid, finalKey);
        completedTokens.set(token, { key: finalKey, expires: expireTime });

        return res.json({ success: true, completedAll: true, key: finalKey, expires: expireTime });
    }

    return res.status(400).json({ success: false, message: "Out of order execution." });
});

// Moved to POST — GET query strings get logged by hosting providers/proxies
app.post('/validate-key', requireApiKey, (req, res) => {
    const { hwid, key } = req.body;
    if (!hwid || !key) return res.status(400).json({ valid: false, message: "Missing hwid or key." });

    const keyData = generatedKeys.get(key);
    if (keyData && keyData.hwid === hwid && Date.now() < keyData.expires) {
        return res.json({ valid: true });
    }
    return res.json({ valid: false });
});

// Basic global error handler so a stray exception doesn't crash the whole process
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error." });
});

app.listen(process.env.PORT || 3000, () => console.log("Pasteable Key Server running!"));
