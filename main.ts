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
const TRIAL_PLAN = {
  traffic_gb: 15,
  duration_days: 1,
};

// -------------------- Data Structures --------------------
interface UserData {
  chatId: string;
  trialUsed: boolean;
  subscription?: {
    username: string;
    expiryDate: string;
    trafficGb: number;
    link: string;
  };
}

// -------------------- Helpers --------------------
async function sendMessage(chatId: string, text: string, parseMode = "Markdown") {
  try {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });
  } catch (err) {
    console.error("Failed to send message:", err);
  }
}

async function getUser(chatId: string): Promise<UserData> {
  const res = await kv.get<UserData>(["users", chatId]);
  return res.value ?? {
    chatId,
    trialUsed: false,
  };
}

async function saveUser(user: UserData) {
  await kv.set(["users", user.chatId], user);
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

async function createMarzbanUser(userId: string, plan: typeof TRIAL_PLAN): Promise<{ link: string; expiryDate: string } | null> {
  const token = await getMarzbanToken();
  if (!token) return null;

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  const userApiUrl = new URL("/api/user", MARZBAN_BASE_URL).toString();
  const dataLimitBytes = plan.traffic_gb * 1024 * 1024 * 1024;
  const expireSeconds = plan.duration_days * 24 * 60 * 60;
  const expireTimestamp = Math.floor(Date.now() / 1000) + expireSeconds;

  const profileTitleStr = `${userId}`;
  const profileTitleB64 = encodeBase64(profileTitleStr);
  const announceB64 = encodeBase64("@PabloTest_RoBot");
  const supportUrl = "https://t.me/TheOldPablo";
  const profileWebPageUrl = "https://t.me/Pablo_Comminuty";

  const payload = {
    username: userId,
    proxies: { shadowsocks: { method: "aes-256-gcm", password: `ss_${userId}_${Math.floor(Math.random() * 900) + 100}` } },
    data_limit: dataLimitBytes,
    expire: expireTimestamp,
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
      const modifyUrl = new URL(`/api/user/${encodeURIComponent(userId)}`, MARZBAN_BASE_URL).toString();
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

    const expiryDate = new Date((expireTimestamp * 1000)).toISOString().slice(0, 16).replace("T", " ");
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
    const msg = update.message;
    if (!msg || msg.chat.type !== "private") return new Response("ok");

    const chatId = String(msg.chat.id);
    const text = msg.text?.trim() || "";

    if (text !== "/start") {
      await sendMessage(chatId, "Use /start to get your trial subscription.");
      return new Response("ok");
    }

    let user = await getUser(chatId);
    if (user.trialUsed && user.subscription) {
      const happCode = await convertToHappCode(user.subscription.link) || user.subscription.link;
      await sendMessage(chatId, `✅ Your existing trial subscription:\nID: ${user.subscription.username}\nExpires: ${user.subscription.expiryDate}\nTraffic: ${user.subscription.trafficGb} GB\n\nCode:\n\`\`\`\n${happCode}\n\`\`\``);
      return new Response("ok");
    }

    await sendMessage(chatId, "⏳ Creating your trial subscription...");

    const subData = await createMarzbanUser(chatId, TRIAL_PLAN);
    if (!subData) {
      await sendMessage(chatId, "❌ Failed to create subscription. Try later.");
      return new Response("ok");
    }

    const happCode = await convertToHappCode(subData.link) || subData.link;

    user.trialUsed = true;
    user.subscription = {
      username: chatId,
      expiryDate: subData.expiryDate,
      trafficGb: TRIAL_PLAN.traffic_gb,
      link: subData.link,
    };
    await saveUser(user);

    await sendMessage(chatId, `✅ Trial subscription created!\nID: ${chatId}\nExpires: ${subData.expiryDate}\nTraffic: ${TRIAL_PLAN.traffic_gb} GB\n\nCode:\n\`\`\`\n${happCode}\n\`\`\``);

  } catch (err) {
    console.error("Error handling update:", err);
  }
  return new Response("ok");
});
