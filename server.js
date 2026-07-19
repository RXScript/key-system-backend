const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

// =================== CONFIGURATION ===================
// 1. Put your exact LootLabs or Linkvertise link prefixes here (include the "url=" part)
const AD_GATE_1 = "https://loot-link.com/s?YOUR_AD_ID_1&url="; 
const AD_GATE_2 = "https://loot-link.com/s?YOUR_AD_ID_2&url="; 

// 2. Put your live GitHub Pages URL here (Ensure it ends with a slash)
const GITHUB_PAGES_URL = "https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/";
// =====================================================

const activeTokens = new Map();       // token -> { hwid, step, expires }
const userProgress = new Map();       // hwid -> completedStepsCount
const authenticatedHWIDs = new Map();   // hwid -> expirationTime

// Route for Roblox script to grab links
app.get('/get-link', (req, res) => {
    const hwid = req.query.hwid;
    if (!hwid) return res.status(400).json({ error: "Missing HWID" });

    const expiry = authenticatedHWIDs.get(hwid);
    if (expiry && Date.now() < expiry) {
        return res.json({ status: "authorized" });
    }

    const completed = userProgress.get(hwid) || 0;
    const token = crypto.randomBytes(16).toString('hex');
    let targetAdLink = "";

    if (completed === 0) {
        activeTokens.set(token, { hwid, step: 1, expires: Date.now() + 600000 });
        const destination = `${GITHUB_PAGES_URL}?token=${token}`;
        targetAdLink = `${AD_GATE_1}${encodeURIComponent(destination)}`;
    } else if (completed === 1) {
        activeTokens.set(token, { hwid, step: 2, expires: Date.now() + 600000 });
        const destination = `${GITHUB_PAGES_URL}?token=${token}`;
        targetAdLink = `${AD_GATE_2}${encodeURIComponent(destination)}`;
    }

    res.json({ status: "checkpoint", link: targetAdLink, currentStep: completed + 1 });
});

// Route for GitHub Pages to verify completion
app.post('/verify-token', (req, res) => {
    const { token } = req.body;
    const tokenData = activeTokens.get(token);

    if (!tokenData || Date.now() > tokenData.expires) {
        return res.status(400).json({ success: false, message: "Invalid or expired token." });
    }

    const { hwid, step } = tokenData;
    const currentCompleted = userProgress.get(hwid) || 0;

    if (step === 1 && currentCompleted === 0) {
        userProgress.set(hwid, 1);
        activeTokens.delete(token);

        const nextToken = crypto.randomBytes(16).toString('hex');
        activeTokens.set(nextToken, { hwid, step: 2, expires: Date.now() + 600000 });
        
        const destination = `${GITHUB_PAGES_URL}?token=${nextToken}`;
        const nextAdLink = `${AD_GATE_2}${encodeURIComponent(destination)}`;

        return res.json({ success: true, completedAll: false, nextLink: nextAdLink });
    }

    if (step === 2 && currentCompleted === 1) {
        authenticatedHWIDs.set(hwid, Date.now() + 24 * 60 * 60 * 1000); // 24 Hour Key
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

app.listen(process.env.PORT || 3000, () => console.log("Server running!"));
