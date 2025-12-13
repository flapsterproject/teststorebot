// main.ts
// 🤖 Happ Seller Bot for VPN Subscriptions
// 📱 Provides VPN subscriptions for Happ app
// 💾 Uses Deno KV for user data (subscriptions, trial used)
// 🔔 Creates trial subscription on /start and sends Happ code
// 📊 Integrates with Marzban panel for user creation
// ⚠️ Simplified version - trial on start, no captcha/channels/payments/admin
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN not set");
const API = `https://api.telegram.org/bot${TOKEN}`;
// -------------------- Marzban Setup --------------------
const MARZBAN_BASE_URL = "http://89.23.97.127:3286/dashboard/login";
const MARZBAN_ADMIN_USER = "05";
const MARZBAN_ADMIN_PASS = "05";
const HAPP_API_URL = "https://crypto.happ.su/api.php";
// -------------------- Deno KV --------------------
const kv = await Deno.openKv();
// -------------------- Constants --------------------
const PLAN = {
  traffic_gb: 100,
};
// -------------------- Helpers --------------------
async function sendMessage(chatId: string, text: string, parseMode = "Markdown") {
  try {
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Failed to send message:", data);
      return null;
    }
    return data.result;
  } catch (err) {
    console.error("Failed to send message:", err);
    return null;
  }
}
async function getMarzbanToken(): Promise<string | null> {
  const tokenUrl = new URL("/api/admin/token", MARZBAN_BASE_URL).toString();
  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: MARZBAN_ADMIN_USER,
        password: MARZBAN_ADMIN_PASS,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.access_token;
  } catch (err) {
    console.error("Failed to get Marzban token:", err);
    return null;
  }
}
async function removeMarzbanUser(username: string): Promise<boolean> {
  const token = await getMarzbanToken();
  if (!token) return false;
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
  };
  const removeUrl = new URL(`/api/user/${encodeURIComponent(username)}`, MARZBAN_BASE_URL).toString();
  try {
    const response = await fetch(removeUrl, {
      method: "DELETE",
      headers,
    });
    if (!response.ok) {
      if (response.status === 404) return true; // already does not exist
      throw new Error(`HTTP ${response.status}`);
    }
    return true;
  } catch (err) {
    console.error("Failed to remove Marzban user:", err);
    return false;
  }
}
async function createMarzbanUser(username: string, plan: typeof PLAN): Promise<{ link: string; expiryDate: string } | null> {
  const token = await getMarzbanToken();
  if (!token) return null;
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  const userApiUrl = new URL("/api/user", MARZBAN_BASE_URL).toString();
  const dataLimitBytes = plan.traffic_gb * 1024 * 1024 * 1024;
  let expire: number | null = null;
  const profileTitleStr = `${username}`;
  const profileTitleB64 = encodeBase64(profileTitleStr);
  const announceB64 = encodeBase64("@PabloTest_RoBot");
  const supportUrl = "https://t.me/Masakoff";
  const profileWebPageUrl = "https://t.me/MasakoffVpns";
  const payload = {
    username: username,
    proxies: { shadowsocks: { method: "aes-256-gcm", password: `ss_${username}_${Math.floor(Math.random() * 900) + 100}` } },
    data_limit: dataLimitBytes,
    expire: expire,
    status: "active",
    inbounds: {},
    "profile-title": `base64:${profileTitleB64}`,
    "support-url": supportUrl,
    "announce": `base64:${announceB64}`,
    "profile-web-page-url": profileWebPageUrl,
  };
  try {
    let response = await fetch(userApiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (response.status === 409) {
      // User exists, modify
      const modifyUrl = new URL(`/api/user/${encodeURIComponent(username)}`, MARZBAN_BASE_URL).toString();
      const getRes = await fetch(modifyUrl, { headers });
      if (!getRes.ok) throw new Error(`HTTP ${getRes.status}`);
      let existingData = await getRes.json();
      existingData = { ...existingData, ...payload };
      delete existingData.on_hold;
      delete existingData.used_traffic;
      delete existingData.created_at;
      delete existingData.subscription_url;
      delete existingData.links;
      response = await fetch(modifyUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify(existingData),
      });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const relativeLink = data.subscription_url;
    if (!relativeLink) throw new Error("No subscription_url");
    const fullLink = new URL(relativeLink, MARZBAN_BASE_URL).toString();
    const expiryDate = "Unlimited";
    return { link: fullLink, expiryDate };
  } catch (err) {
    console.error("Failed to create/update Marzban user:", err);
    return null;
  }
}
async function convertToHappCode(subUrl: string): Promise<string | null> {
  try {
    const response = await fetch(HAPP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ url: subUrl }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.encrypted_link || null;
  } catch (err) {
    console.error("Failed to convert to Happ code:", err);
    return null;
  }
}
// -------------------- Webhook Handler --------------------
serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    const update = await req.json();
    const msg = update.message || update.channel_post;
    if (!msg) return new Response("ok");
    const chatId = String(msg.chat.id);
    const text = msg.text?.trim() || "";
    const isPrivate = msg.chat.type === "private";
    const isAdmin = isPrivate && msg.from?.username === "Masakoff";
    const isHelperChannel = msg.chat.type === "channel" && msg.chat.username === "Vpnchannelshelperchannel";
    if (!((isAdmin && text === "/start") || (isHelperChannel && text === "/start"))) {
      if (isAdmin) {
        await sendMessage(chatId, "Use /start to get your subscription.");
      }
      return new Response("ok");
    }
    if (isPrivate) await sendMessage(chatId, "⏳ Deleting and creating subscription for Kanallar...");
    const username = "Kanallar";
    await removeMarzbanUser(username);
    const subData = await createMarzbanUser(username, PLAN);
    if (!subData) {
      if (isPrivate) await sendMessage(chatId, "❌ Failed to create subscription. Try later.");
      return new Response("ok");
    }
    const happCode = await convertToHappCode(subData.link) || subData.link;
    if (isPrivate) await sendMessage(chatId, `✅ Subscription created!\nID: ${username}\nExpires: ${subData.expiryDate}\nTraffic: ${PLAN.traffic_gb} GB\n\nCode:\n\`\`\`\n${happCode}\n\`\`\``);
    // Send to channels
    const channels = ["@HappService", "@MasakoffVpns"];
    for (const channel of channels) {
      const messageText = `\`\`\`\n${happCode}\n\`\`\`**😎 Happ VPN**\n**💻 Устройство: Android 📱 | iOS 🌟**\n**☄️ Пинг: 100–300 мс**\n\n\`\`\`Spasibo❤️\nСпасибо всем за лайки, Не забудьте поделиться кодом с друзьями. 👑\n\`\`\`\n**✈️ ${channel}**`;
      const sentMessage = await sendMessage(channel, messageText, "Markdown");
      if (sentMessage) {
        try {
          await fetch(`${API}/setMessageReaction`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: channel,
              message_id: sentMessage.message_id,
              reaction: [{ type: "emoji", emoji: "❤" }],
            }),
          });
        } catch (err) {
          console.error("Failed to set reaction:", err);
        }
      }
    }
  } catch (err) {
    console.error("Error handling update:", err);
  }
  return new Response("ok");
});


