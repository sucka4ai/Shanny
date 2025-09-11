// ---------------- IPTV ADDON CODE ----------------
const { serveHTTP, addonBuilder } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const parser = require("iptv-playlist-parser");
const xml2js = require("xml2js");
const dayjs = require("dayjs");

const M3U_URL = process.env.M3U_URL;
const EPG_URL = process.env.EPG_URL;

let channels = [];
let epgData = {};
let categories = new Set();

// ---------------- FETCH FUNCTIONS ----------------

async function fetchM3U() {
    try {
        const res = await fetch(M3U_URL, { timeout: 15000 });
        const text = await res.text();
        const parsed = parser.parse(text);

        categories = new Set();
        channels = parsed.items.map((item, index) => {
            const category = item.group?.title || "Uncategorized";
            categories.add(category);
            return {
                id: `channel-${index}`,
                name: item.name,
                url: item.url,
                logo: item.tvg.logo,
                category,
                tvgId: item.tvg.id,
            };
        });

        console.log(`✅ Loaded ${channels.length} channels`);
    } catch (err) {
        console.error("❌ Failed to fetch M3U:", err.message);
    }
}

async function fetchEPG() {
    try {
        const res = await fetch(EPG_URL, { timeout: 15000 });
        const xml = await res.text();
        const result = await xml2js.parseStringPromise(xml);

        const programs = result.tv.programme || [];
        epgData = {};
        for (const program of programs) {
            const channelId = program.$.channel;
            if (!epgData[channelId]) epgData[channelId] = [];
            epgData[channelId].push({
                start: program.$.start,
                stop: program.$.stop,
                title: program.title?.[0]?._ || "No Title",
                desc: program.desc?.[0]?._ || "",
            });
        }

        console.log(`✅ Loaded EPG with ${programs.length} programmes`);
    } catch (err) {
        console.error("❌ Failed to fetch EPG:", err.message);
    }
}

// ---------------- HELPER FUNCTIONS ----------------

function getNowNext(channelId) {
    const now = dayjs();
    const programs = epgData[channelId] || [];
    let nowProgram = null;
    let nextProgram = null;

    for (let i = 0; i < programs.length; i++) {
        const start = dayjs(programs[i].start, "YYYYMMDDHHmmss ZZ");
        const end = dayjs(programs[i].stop, "YYYYMMDDHHmmss ZZ");
        if (now.isAfter(start) && now.isBefore(end)) {
            nowProgram = programs[i];
            nextProgram = programs[i + 1] || null;
            break;
        }
    }

    return { now: nowProgram, next: nextProgram };
}

function getUnsplashImage(category) {
    const encoded = encodeURIComponent(category || "tv");
    return `https://source.unsplash.com/1600x900/?${encoded}`;
}

// ---------------- MANIFEST & ADDON ----------------

const manifest = {
    id: "community.shannyiptv",
    version: "1.0.0",
    name: "Shanny IPTV",
    description: "IPTV with category filtering and EPG",
    logo: "https://upload.wikimedia.org/wikipedia/commons/9/99/TV_icon_2.svg",
    resources: ["catalog", "stream", "meta"],
    types: ["tv"],
    catalogs: [
        {
            type: "tv",
            id: "shannyiptv",
            name: "Shanny IPTV",
            extra: [{ name: "genre", options: ["All"] }],
        },
    ],
    idPrefixes: ["channel-"],
};

const builder = new addonBuilder(manifest);

// ---------------- STREAM HANDLER ----------------
builder.defineStreamHandler((args) => {
    const channelId = args.id;
    const channel = channels.find(c => c.id === channelId);

    if (!channel) {
        return Promise.resolve({ streams: [] });
    }

    // Detect stream type from URL
    let mimetype = "video/mp2t"; // default for .ts streams
    if (channel.url && channel.url.endsWith(".m3u8")) {
        mimetype = "application/vnd.apple.mpegurl";
    } else if (channel.url && channel.url.endsWith(".mp4")) {
        mimetype = "video/mp4";
    }

    console.log(`StreamHandler: Selected ${mimetype} for ${channel.name}`);

    return Promise.resolve({
        streams: [
            {
                title: channel.name,
                url: channel.url,
                type: "url",
                mimetype: mimetype,
                behaviorHints: {
                    notWebReady: false,
                    proxyHeaders: {
                        request: {
                            "User-Agent": "Mozilla/5.0",
                            "Accept": "*/*",
                            "Accept-Encoding": "gzip, deflate, br",
                            "Accept-Language": "en-US,en;q=0.9",
                            "Range": "bytes=0-"
                        }
                    }
                }
            }
        ]
    });
});




// ---------------- START SERVER ----------------

(async () => {
    await fetchM3U();
    await fetchEPG();

    // Update manifest with categories
    if (categories.size > 0) {
        manifest.catalogs[0].extra[0].options = [
            "All",
            ...Array.from(categories).sort(),
        ];
        console.log("✅ Manifest categories updated:", manifest.catalogs[0].extra[0].options);
    }

    const port = process.env.PORT || 3000;
    serveHTTP(builder.getInterface(), { port });
    console.log(`🚀 Shanny IPTV Addon running on port ${port}`);
})();

