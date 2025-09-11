// ---------------- IPTV ADDON CODE ----------------
const { serveHTTP, addonBuilder } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const parser = require("iptv-playlist-parser");
const xml2js = require("xml2js");
const dayjs = require("dayjs");

const M3U_URL = process.env.M3U_URL;
const EPG_URL = process.env.EPG_URL;

let channels = []; // array of channels
let channelMap = {}; // { id: channel } for fast lookup
let epgData = {};
let categories = new Set();
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

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
                logo: item.tvg?.logo || "",
                category,
                tvgId: item.tvg?.id || "",
            };
        });

        // rebuild fast lookup map
        channelMap = {};
        channels.forEach(c => { channelMap[c.id] = c; });

        // Update manifest categories safely
        if (categories.size > 0) {
            manifest.catalogs[0].extra = [{
                name: "genre",
                options: ["All", ...Array.from(categories).sort()]
            }];
        }

        console.log(`✅ Loaded ${channels.length} channels`);
        console.log("✅ Manifest categories updated:", manifest.catalogs[0].extra[0].options);
    } catch (err) {
        console.error("❌ Failed to fetch M3U:", err.message);
    }
}

async function fetchEPG() {
    try {
        const res = await fetch(EPG_URL, { timeout: 15000 });
        const xml = await res.text();
        const result = await xml2js.parseStringPromise(xml);

        const programs = result.tv?.programme || [];
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

    return { now, next: nextProgram };
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

// ---------------- CATALOG HANDLER ----------------
builder.defineCatalogHandler((args) => {
    const genre = args.extra?.find((e) => e.name === "genre")?.value;

    const filteredChannels = !genre || genre === "All"
        ? channels
        : channels.filter(c => c.category === genre);

    // only minimal data for catalog
    const metas = filteredChannels.map(c => ({
        id: c.id,
        name: c.name,
        type: "tv",
        poster: c.logo || getUnsplashImage(c.category),
        background: getUnsplashImage(c.category),
    }));

    return { metas };
});

// ---------------- STREAM HANDLER ----------------
builder.defineStreamHandler((args) => {
    const channel = channelMap[args.id];
    if (!channel) return { streams: [] };

    let mimetype = "video/mp2t";
    if (channel.url.endsWith(".m3u8")) mimetype = "application/vnd.apple.mpegurl";
    else if (channel.url.endsWith(".mp4")) mimetype = "video/mp4";

    return {
        streams: [
            {
                title: channel.name,
                url: channel.url,
                type: "url",
                mimetype,
                behaviorHints: {
                    notWebReady: false,
                    proxyHeaders: {
                        request: {
                            "User-Agent": "Mozilla/5.0",
                            "Accept": "*/*",
                            "Accept-Encoding": "gzip, deflate, br",
                            "Accept-Language": "en-US,en;q=0.9",
                            "Range": "bytes=0-",
                        },
                    },
                },
            },
        ],
    };
});

// ---------------- META HANDLER ----------------
builder.defineMetaHandler((args) => {
    const channel = channelMap[args.id];
    if (!channel) return null;

    const { now, next } = getNowNext(channel.tvgId);

    return {
        id: channel.id,
        type: "tv",
        name: channel.name,
        description: now ? `${now.title} | ${next ? "Next: " + next.title : ""}` : "",
        poster: channel.logo || getUnsplashImage(channel.category),
        background: getUnsplashImage(channel.category),
    };
});

// ---------------- START SERVER ----------------
(async () => {
    await fetchM3U();
    await fetchEPG();

    setInterval(async () => {
        console.log("🔄 Refreshing M3U playlist and EPG...");
        await fetchM3U();
        await fetchEPG();
    }, REFRESH_INTERVAL);

    const port = process.env.PORT || 3000;
    serveHTTP(builder.getInterface(), { port });
    console.log(`🚀 Shanny IPTV Addon running on port ${port}`);
})();
