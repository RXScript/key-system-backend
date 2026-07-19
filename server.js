const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

// =================== LINKVERTISE CONFIGURATION ===================
const LINKVERTISE_USER_ID = "7599156"; // Put your 6-7 digit User ID here
const GITHUB_PAGES_URL = "https://rxscript.github.io/";
// =================================================================

const activeTokens = new Map();       
const userProgress = new Map();       
const authenticatedHWIDs = new Map();   

// Helper function to safely encode URLs to Base64 for Linkvertise
function encodeBase64(text) {
    return Buffer.from(text).toString('base64');
}

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
        
        // Linkvertise Checkpoint 1 Dynamic Link Generation
        targetAdLink = `https://link-to.net/${LINKVERTISE_USER_ID}/${Math.floor(Math.random() * 99999)}/dynamic?r=${encodeBase64(destination)}`;
        
    } else if (completed === 1) {
        activeTokens.set(token, { hwid, step: 2, expires: Date.now() + 600000 });
        const destination = `${GITHUB_PAGES_URL}?token=${token}`;
        
        // Linkvertise Checkpoint 2 Dynamic Link Generation
        targetAdLink = `https://link-to.net/${LINKVERTISE_USER_ID}/${Math.floor(Math.random() * 99999)}/dynamic?r=${encodeBase64(destination)}`;
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
        const nextAdLink = `https://link-to.net/${LINKVERTISE_USER_ID}/${Math.floor(Math.random() * 99999)}/dynamic?r=${encodeBase64(destination)}`;

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

app.listen(process.env.PORT || 3000, () => console.log("Linkvertise key system server running!"));
