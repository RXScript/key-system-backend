const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

// =================== CONFIGURATION ===================
const GITHUB_PAGES_URL = "https://rxscript.github.io/";

// 1. LINKVERTISE
const LINKVERTISE_USER_ID = "7599156"; 

// 2. LOOTLABS (Requires different ad IDs for each checkpoint)
const LOOTLABS_CP1 = "https://loot-link.com/s?yKatk89I&url=";
const LOOTLABS_CP2 = "https://loot-link.com/s?yKatk89I&url=";

// 3. WORK.INK (Replace with your actual Work.ink alias/path)
const WORKINK_URL = "https://work.ink/2KRk/key-system?url=";
// =====================================================

const activeTokens = new Map();       
const userProgress = new Map();       
const authenticatedHWIDs = new Map();   

// Helper: Safely encode URLs
const encodeBase64 = (text) => Buffer.from(text).toString('base64');

// Helper: Route the link generation based on the chosen provider
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
    return destination; // Fallback
};

// Route 1: Roblox script grabs the link for the chosen provider
app.get('/get-link', (req, res) => {
    const { hwid, provider } = req.query;
    if (!hwid) return res.status(400).json({ error: "Missing HWID" });
    
    // Default to linkvertise if they send a weird request
    const safeProvider = ['linkvertise', 'workink', 'lootlabs'].includes(provider) ? provider : 'linkvertise';

    const expiry = authenticatedHWIDs.get(hwid);
    if (expiry && Date.now() < expiry) {
        return res.json({ status: "authorized" });
    }

    const completed = userProgress.get(hwid) || 0;
    const token = crypto.randomBytes(16).toString('hex');
    const step = completed + 1;

    // Save the chosen provider in the token data so we remember it for checkpoint 2
    activeTokens.set(token, { hwid, step, provider: safeProvider, expires: Date.now() + 600000 });
    
    const destination = `${GITHUB_PAGES_URL}?token=${token}`;
    const targetAdLink = generateAdLink(destination, safeProvider, step);

    res.json({ status: "checkpoint", link: targetAdLink, currentStep: step });
});

// Route 2: GitHub Pages verifies completion
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

        // Generate the token for Checkpoint 2 using the SAME provider they chose for Checkpoint 1
        const nextToken = crypto.randomBytes(16).toString('hex');
        activeTokens.set(nextToken, { hwid, step: 2, provider, expires: Date.now() + 600000 });
        
        const destination = `${GITHUB_PAGES_URL}?token=${nextToken}`;
        const nextAdLink = generateAdLink(destination, provider, 2);

        return res.json({ success: true, completedAll: false, nextLink: nextAdLink });
    }

    if (step === 2 && currentCompleted === 1) {
        authenticatedHWIDs.set(hwid, Date.now() + 24 * 60 * 60 * 1000); 
        userProgress.delete(hwid);
        activeTokens.delete(token);
        return res.json({ success: true, completedAll: true });
    }

    return res.status(400).json({ success: false, message: "Out of order execution." });
});

app.get('/check-key', (req, res) => {
    const hwid = req.query.hwid;
    const expiry = authenticatedHWIDs.get(hwid);
    if (expiry && Date.now() < expiry) {
        return res.json({ authorized: true });
    }
    res.json({ authorized: false });
});

app.listen(process.env.PORT || 3000, () => console.log("Multi-provider server running!"));
