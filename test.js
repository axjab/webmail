
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const credentials = JSON.parse(
    fs.readFileSync('/home/a/.config/webmail/credentials.json', 'utf8')
);

const CACHE_DIR = path.join(__dirname, 'cache', 'emails');
const HOST_IP = '192.168.65.254';

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
                } catch {
                    reject(new Error(`Invalid Chrome response: ${data}`));
                }
            });
        }).on('error', reject);
    });
}

async function extractEmails(page) {
    for (const frame of page.frames()) {
        try {
            const emails = await frame.evaluate(() => {
                return Array.from(
                    document.querySelectorAll('[data-convid]')
                ).map(row => {
                    const getText = selector =>
                        row.querySelector(selector)?.innerText?.trim() || '';

                    return {
                        id: row.getAttribute('data-convid'),
                        title: getText('[autoid="_lvv_6"]'),
                        sender: getText('[autoid="_lvv_5"]'),
                        preview: getText('[autoid="_lvv_7"]'),
                        html: row.outerHTML
                    };
                }).filter(email => email.id);
            });

            if (emails.length) {
                return emails;
            }
        } catch {
            // Ignore frames that are unavailable during navigation.
        }
    }

    return [];
}

(async () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    const info = await getChromeInfo();
    const ws = info.webSocketDebuggerUrl.replace(
        'localhost',
        `${HOST_IP}:9222`
    );

    const browser = await chromium.connectOverCDP(ws);
    const context = browser.contexts()[0];
    const page = await context.newPage();

    await page.goto('https://webmail.one-07.grp', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
    });

    console.log(`\nOpened: ${page.url()}`);
    console.log(`Page:   ${await page.title()}`);

    // Sign in only if the login form is present.
    if (await page.locator('#username').count()) {
        await page.locator('#username').fill(credentials.username);
        await page.locator('#password').fill(credentials.password);

        await page.locator(
            '#lgnDiv > div.signInEnter > div'
        ).click();

        console.log('Login submitted; waiting for inbox...');
    }

    // Wait for inbox rows to appear, including rows inside frames.
    let emails = [];
    const deadline = Date.now() + 90000;

    while (Date.now() < deadline) {
        emails = await extractEmails(page);

        if (emails.length) break;

        await page.waitForTimeout(1000);
    }

    if (!emails.length) {
        console.log('\nNo email rows found.');
        console.log('Current URL:', page.url());

        for (const frame of page.frames()) {
            try {
                const info = await frame.evaluate(() => ({
                    url: location.href,
                    title: document.title,
                    body: document.body?.innerText?.slice(0, 500) || ''
                }));

                console.log('\nFrame:', info.url);
                console.log('Title:', info.title);
                console.log('Text:', info.body);
            } catch {
                // Ignore inaccessible frames.
            }
        }

        throw new Error('Inbox rows did not appear within 90 seconds.');
    }

    const manifest = [];

    console.log(`\nFound ${emails.length} email(s)\n`);

    for (const [index, email] of emails.entries()) {
        const filename = `${String(index + 1).padStart(3, '0')}.html`;
        const firstWords = (email.preview || '')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 12)
            .join(' ');

        fs.writeFileSync(
            path.join(CACHE_DIR, filename),
            email.html,
            'utf8'
        );

        manifest.push({
            id: email.id,
            title: email.title,
            sender: email.sender,
            preview: email.preview,
            file: filename
        });

        console.log(`EMAIL ${index + 1}`);
        console.log(`  ID:      ${email.id}`);
        console.log(`  TITLE:   ${email.title || '(no subject found)'}`);
        console.log(`  PREVIEW: ${firstWords || '(no preview found)'}`);
        console.log(`  CACHE:   ${filename}\n`);
    }

    fs.writeFileSync(
        path.join(CACHE_DIR, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
    );

    console.log('----------------------------------------');
    console.log(`Cached ${manifest.length} email(s).`);
    console.log(`Location: ${CACHE_DIR}`);
    console.log('References saved in manifest.json');

    // Leave the browser open for subsequent inspection.
})();

