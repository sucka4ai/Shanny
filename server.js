const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const parser = require("iptv-playlist-parser");

const M3U_URL = process.env.M3U_URL;
const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SELF_PING_INTERVAL = 2 * 60 * 1000; // 2 minutes

let channels = [];
let categories = new Set();

// ---------------- FETCH FUNCTIONS ----------------
async function fetchM3U() {
    try {
        const res = await fetch(M3U_URL, { timeout: 15000 });
        const text = await res.text();
        const parsed = parser.parse(text);

        channels = parsed.items.map((item, index) => {
            const category = item.group?.title || "Uncategorized";
            categories.add(category);
            return {
                id: `channel-${index}`,
                name: item.name,
                url: item.url,
                category
            };
        });

        console.log(`✅ Loaded ${channels.length} channels`);
    } catch (err) {
        console.error("❌ Failed to fetch M3U:", err.message);
    }
}

// ---------------- MANIFEST ----------------
const manifest = {
    id: "community.shannyiptv",
    version: "1.0.0",
    name: "Shanny IPTV",
    description: "Dynamic IPTV addon with auto-refresh and self-ping",
    resources: ["catalog", "stream", "meta"],
    types: ["tv"],
    idPrefixes: ["channel"],
    catalogs: [
        {
            type: "tv",
            id: "shannyiptv",
            name: "Shanny IPTV",
            extra: [{ name: "genre", options: ["All"] }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// ---------------- CATALOG HANDLER ----------------
builder.defineCatalogHandler(({ type, extra }) => {
    const genre = extra?.find(e => e.name === "genre")?.value;
    const filteredChannels = genre && genre !== "All"
        ? channels.filter(c => c.category === genre)
        : channels;

    const metas = filteredChannels.map(c => ({
        id: c.id,
        type: "tv",
        name: c.name,
        poster: "https://via.placeholder.com/300x450.png?text=" + encodeURIComponent(c.name)
    }));

    return Promise.resolve({ metas });
});

// ---------------- STREAM HANDLER ----------------
builder.defineStreamHandler(({ id }) => {
    const channel = channels.find(c => c.id === id);
    if (!channel) return Promise.resolve({ streams: [] });

    let mimetype = "video/mp2t";
    if (channel.url.endsWith(".m3u8")) mimetype = "application/vnd.apple.mpegurl";
    else if (channel.url.endsWith(".mp4")) mimetype = "video/mp4";

    return Promise.resolve({
        streams: [{
            title: channel.name,
            url: channel.url,
            type: "url",
            mimetype
        }]
    });
});

// ---------------- META HANDLER ----------------
builder.defineMetaHandler(({ id }) => {
    const channel = channels.find(c => c.id === id);
    return Promise.resolve({
        meta: {
            id,
            type: "tv",
            name: channel?.name || "Unknown",
            poster: "https://via.placeholder.com/300x450.png/000/fff?text=" + encodeURIComponent(channel?.name || "Unknown")
        }
    });
});

// ---------------- START SERVER ----------------
(async () => {
    await fetchM3U();

    // Update catalog with dynamic categories
    manifest.catalogs[0].extra[0].options = ["All", ...Array.from(categories).sort()];

    serveHTTP(builder.getInterface(), { port: PORT });
    console.log(`🚀 Shanny IPTV Addon running on port ${PORT}`);

    // ---------------- AUTO-REFRESH ----------------
    setInterval(async () => {
        console.log("🔄 Refreshing M3U playlist...");
        categories.clear();
        await fetchM3U();
        manifest.catalogs[0].extra[0].options = ["All", ...Array.from(categories).sort()];
        console.log("✅ Categories refreshed:", manifest.catalogs[0].extra[0].options);
    }, REFRESH_INTERVAL);

    // ---------------- SELF-PING ----------------
    const publicUrl = process.env.KOYEB_URL || `http://localhost:${PORT}`;
    setInterval(() => {
        fetch(`${publicUrl}/manifest.json`)
            .then(() => console.log(`🔄 Self-ping OK at ${new Date().toLocaleTimeString()}`))
            .catch(err => console.log("⚠️ Self-ping failed:", err.message));
    }, SELF_PING_INTERVAL);
})();
