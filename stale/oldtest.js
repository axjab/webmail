const http = require('node:http');
const { chromium } = require('playwright');

const fs = require('node:fs');

const credentials = JSON.parse(
    fs.readFileSync(
        '/home/a/.config/webmail/credentials.json',
        'utf8'
    )
);


function getChromeInfo() {
    return new Promise((resolve, reject) => {
        http.get({
            hostname: 'host.docker.internal',
            port: 9222,
            path: '/json/version',
            headers: { Host: 'localhost' }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(new Error(data));
                }
            });
        }).on('error', reject);
    });
}

(async () => {
    const info = await getChromeInfo();

    const ws = info.webSocketDebuggerUrl.replace(
        'localhost',
        '192.168.65.254:9222'
    );

    const browser = await chromium.connectOverCDP(ws);
    const context = browser.contexts()[0];
    const page = await context.newPage();

    await page.goto('https://webmail.one-07.grp', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
    });

    console.log('Opened:', page.url());
    console.log('Title:', await page.title());
    
    await page.locator('#username').fill(credentials.username);
    await page.locator('#password').fill(credentials.password);

    await page.locator(
        '#lgnDiv > div.signInEnter > div'
    ).click();

    console.log('Login submitted');

    const fs = require('node:fs');
    const path = require('node:path');

    const cacheDir = path.join(__dirname, 'cache', 'emails');
    fs.mkdirSync(cacheDir, { recursive: true });

    await page.locator('div[data-convid]').first().waitFor();

    const emails = await page.locator('div[data-convid]').evaluateAll(rows =>
        rows.map(row => ({
            id: row.getAttribute('data-convid'),
            sender: row.querySelector('[autoid="_lvv_5"]')?.innerText.trim(),
            subject: row.querySelector('[autoid="_lvv_6"]')?.innerText.trim(),
            preview: row.querySelector('[autoid="_lvv_7"]')?.innerText.trim(),
            html: row.outerHTML
        }))
    );

    const manifest = [];

    for (const [index, email] of emails.entries()) {
        const filename = `${String(index + 1).padStart(3, '0')}.html`;

        fs.writeFileSync(
            path.join(cacheDir, filename),
            email.html,
            'utf8'
        );

        manifest.push({
            ref: email.id,
            sender: email.sender,
            subject: email.subject,
            preview: email.preview,
            file: filename
        });
    }

    fs.writeFileSync(
        path.join(cacheDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
    );

    console.log(`Cached ${manifest.length} emails.`);
    console.log('References:', manifest.map(e => ({
        ref: e.ref,
        subject: e.subject
    })));
})();

