const express = require('express');
const crypto = require('crypto');
const app = express();
const cors = require('cors'); // Helps prevent connection errors from GitHub

app.use(express.json());
app.use(cors()); 

// =================== CONFIGURATION ===================
const GITHUB_PAGES_URL = "https://rxscript.github.io/";

const LINKVERTISE_USER_ID = "7599156"; 

const LOOTLABS_CP1 = "https://loot-link.com/s?yKatk89I&url=";
const LOOTLABS_CP2 = "https://loot-link.com/s?yKatk89I&url="; // We recommend changing this ID later!

const WORKINK_URL = "https://work.ink/2KRk/key-system?url=";
// =====================================================

const activeTokens = new Map();       
const userProgress = new Map();       
const generatedKeys = new Map(); // NEW: Stores the final copy-paste keys

const encodeBase64 = (text) => Buffer.from(text).toString('base64');

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

app.get('/get-link', (req, res) => {
    const { hwid, provider } = req.query;
    if (!hwid) return res.status(400).json({ error: "Missing HWID" });
    
    const safeProvider = ['linkvertise', 'workink', 'lootlabs'].includes(provider) ? provider : 'linkvertise';

    // If they already generated a key recently, just give them a fresh link anyway 
    // so they don't get stuck if they lost the key.
    const completed = userProgress.get(hwid) || 0;
    const token = crypto.randomBytes(16).toString('hex');
    const step = completed + 1;

    activeTokens.set(token, { hwid, step, provider: safeProvider, expires: Date.now() + 600000 });
    
    const destination = `${GITHUB_PAGES_URL}?token=${token}`;
    res.json({ status: "checkpoint", link: generateAdLink(destination, safeProvider, step), currentStep: step });
});

app.post('/verify-token', (req, res) => {
    const { token } = req.body;
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
        
        // NEW: Generate the final text key (e.g., RX-a1b2c3d4)
        const finalKey = "RX-" + crypto.randomBytes(4).toString('hex');
        
        // Store it for 24 hours
        generatedKeys.set(finalKey, { hwid: hwid, expires: Date.now() + 24 * 60 * 60 * 1000 });
        
        return res.json({ success: true, completedAll: true, key: finalKey });
    }

    return res.status(400).json({ success: false, message: "Out of order execution." });
});

// NEW ROUTE: Roblox script checks if the typed key is valid
app.get('/validate-key', (req, res) => {
    const { hwid, key } = req.query;
    const keyData = generatedKeys.get(key);
    
    if (keyData && keyData.hwid === hwid && Date.now() < keyData.expires) {
        return res.json({ valid: true });
    }
    return res.json({ valid: false });
});

app.listen(process.env.PORT || 3000, () => console.log("Pasteable Key Server running!"));
