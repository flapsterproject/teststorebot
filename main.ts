// main.ts
// 🤖 Smart Signals Bot for Crypto Markets
// 📈 Provides educational signals on trends, RSI, EMA, S/R, and combined (premium)
// 💾 Uses Deno KV for user data (preferences, premium status, last alerts)
// 🔔 Pushes alerts to private chats based on user settings and cooldowns
// 📊 Fetches data from Binance API (REST historical + WebSocket real-time)
// ⚠️ Educational only - not financial advice
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import * as TI from "npm:technicalindicators";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN not set");
const API = `https://api.telegram.org/bot${TOKEN}`;

// -------------------- Deno KV --------------------
const kv = await Deno.openKv();

// -------------------- Constants --------------------
const ASSETS = ["btc", "eth", "sol"]; // Add more as needed
const TIMEFRAMES = ["5m", "15m", "1h", "4h"];
const INDICATORS = ["trend", "rsi", "ema", "sr", "combined"];
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per signal type per asset/tf

// -------------------- Data Structures --------------------
type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const candles: Record<string, Record<string, Candle[]>> = {};
for (const asset of ASSETS) {
  candles[asset] = {};
  for (const tf of TIMEFRAMES) {
    candles[asset][tf] = [];
  }
}

interface UserData {
  chatId: string;
  premium: boolean;
  assets: string[];
  timeframes: string[];
  indicators: string[];
  lastAlerts: Record<string, number>; // key: `${asset}-${tf}-${type}`
}

// -------------------- Helpers --------------------
async function sendMessage(chatId: string, text: string, replyToMessageId?: number) {
  try {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_to_message_id: replyToMessageId,
        parse_mode: "Markdown",
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
    premium: false,
    assets: [],
    timeframes: [],
    indicators: [],
    lastAlerts: {},
  };
}

async function saveUser(user: UserData) {
  await kv.set(["users", user.chatId], user);
}

async function getAllUsers(): Promise<UserData[]> {
  const users = [];
  for await (const entry of kv.list<UserData>({ prefix: ["users"] })) {
    users.push(entry.value);
  }
  return users;
}

// -------------------- Data Fetching --------------------
async function fetchHistorical(asset: string, tf: string, limit = 200): Promise<Candle[]> {
  const symbol = asset.toUpperCase() + "USDT";
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any[][] = await res.json();
    return data.map((d) => ({
      time: d[0],
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
    }));
  } catch (err) {
    console.error(`Failed to fetch historical for ${asset}/${tf}:`, err);
    return [];
  }
}

// Initialize historical data
console.log("Fetching historical data...");
await Promise.all(
  ASSETS.map(async (asset) => {
    await Promise.all(
      TIMEFRAMES.map(async (tf) => {
        candles[asset][tf] = await fetchHistorical(asset, tf, 200);
      })
    );
  })
);
console.log("Historical data loaded.");

// Set up WebSocket
const ws = new WebSocket("wss://stream.binance.com:9443/ws");
ws.onopen = () => {
  const streams = ASSETS.flatMap((asset) =>
    TIMEFRAMES.map((tf) => `${asset}usdt@kline_${tf}`)
  );
  ws.send(
    JSON.stringify({
      method: "SUBSCRIBE",
      params: streams,
      id: 1,
    })
  );
  console.log("WebSocket subscribed to streams.");
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.e !== "kline") return;
  const k = data.k;
  const asset = k.s.replace("USDT", "").toLowerCase();
  const tf = k.i;
  if (!ASSETS.includes(asset) || !TIMEFRAMES.includes(tf)) return;
  const candle: Candle = {
    time: k.t,
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: parseFloat(k.v),
  };
  const list = candles[asset][tf];
  if (list.length === 0) return;
  if (list[list.length - 1].time === k.t) {
    list[list.length - 1] = candle; // Update current candle
  } else if (k.x) { // Closed candle
    list.push(candle);
    if (list.length > 200) list.shift();
    checkAndSendSignals(asset, tf);
  }
};

ws.onerror = (err) => console.error("WebSocket error:", err);
ws.onclose = () => console.log("WebSocket closed. Reconnecting..."); // Add reconnect logic if needed

// -------------------- Indicator Formulas --------------------
function getCloses(asset: string, tf: string): number[] {
  return candles[asset][tf].map((c) => c.close);
}

function getTrend(asset: string, tf: string): string {
  const list = candles[asset][tf];
  if (list.length < 200) return "unknown";
  const closes = getCloses(asset, tf);
  const ema50Results = TI.EMA({ period: 50, values: closes });
  const ema200Results = TI.EMA({ period: 200, values: closes });
  const ema50 = ema50Results[ema50Results.length - 1];
  const ema200 = ema200Results[ema200Results.length - 1];
  const price = closes[closes.length - 1];
  if (price > ema50 && ema50 > ema200) return "uptrend";
  if (price < ema50 && ema50 < ema200) return "downtrend";
  return "sideways";
}

function getRSI(asset: string, tf: string): number {
  const closes = getCloses(asset, tf);
  if (closes.length < 15) return 50; // Neutral default
  const rsiResults = TI.RSI({ period: 14, values: closes });
  return rsiResults[rsiResults.length - 1];
}

function checkEMACross(asset: string, tf: string): string | null {
  const closes = getCloses(asset, tf);
  if (closes.length < 201) return null;
  const ema50Results = TI.EMA({ period: 50, values: closes });
  const ema200Results = TI.EMA({ period: 200, values: closes });
  const len = ema50Results.length;
  const prev50 = ema50Results[len - 2];
  const curr50 = ema50Results[len - 1];
  const prev200 = ema200Results[len - 2];
  const curr200 = ema200Results[len - 1];
  if (prev50 < prev200 && curr50 > curr200) return "bullish";
  if (prev50 > prev200 && curr50 < curr200) return "bearish";
  return null;
}

function getSupportResistance(asset: string, tf: string): { support: number; resistance: number } {
  const list = candles[asset][tf].slice(-50);
  if (list.length < 50) return { support: 0, resistance: 0 };
  const lows = list.map((c) => c.low);
  const highs = list.map((c) => c.high);
  return {
    support: Math.min(...lows),
    resistance: Math.max(...highs),
  };
}

// -------------------- Signal Engine --------------------
interface Signal {
  type: string;
  data: any;
}

async function checkAndSendSignals(asset: string, tf: string) {
  const now = Date.now();
  const trend = getTrend(asset, tf);
  const rsi = getRSI(asset, tf);
  const emaCross = checkEMACross(asset, tf);
  const { support, resistance } = getSupportResistance(asset, tf);
  const price = candles[asset][tf][candles[asset][tf].length - 1].close;

  const signals: Signal[] = [];

  // Trend signal (if not sideways)
  if (trend !== "sideways" && trend !== "unknown") {
    signals.push({ type: "trend", data: { trend, timeframe: tf } });
  }

  // RSI signal
  if (rsi > 70) {
    signals.push({ type: "rsi", data: { rsi: Math.round(rsi), status: "overbought" } });
  } else if (rsi < 30) {
    signals.push({ type: "rsi", data: { rsi: Math.round(rsi), status: "oversold" } });
  }

  // EMA cross signal
  if (emaCross) {
    signals.push({ type: "ema", data: { cross: emaCross } });
  }

  // S/R proximity (within 1%)
  if (Math.abs(price - support) / price < 0.01) {
    signals.push({ type: "sr", data: { level: "support", value: support.toFixed(2) } });
  } else if (Math.abs(price - resistance) / price < 0.01) {
    signals.push({ type: "sr", data: { level: "resistance", value: resistance.toFixed(2) } });
  }

  // Combined signal (example logic)
  const ema50Results = TI.EMA({ period: 50, values: getCloses(asset, tf) });
  const ema50 = ema50Results[ema50Results.length - 1];
  if (trend === "uptrend" && rsi > 30 && rsi < 70 && price > ema50 && Math.abs(price - support) / price < 0.05) {
    signals.push({ type: "combined", data: { trend, rsi: Math.round(rsi), aboveEma50: true } });
  }

  // Send to users
  const users = await getAllUsers();
  for (const sig of signals) {
    for (let user of users) {
      // Filter by user settings
      if (!user.assets.includes(asset)) continue;
      if (!user.timeframes.includes(tf)) continue;
      if (!user.indicators.includes(sig.type)) continue;

      // Premium checks
      if (sig.type === "combined" && !user.premium) continue;
      if (!user.premium && asset !== "btc") continue; // Free: only BTC
      if (!user.premium && tf !== "1h") continue; // Free: only 1h

      // Cooldown check
      const key = `${asset}-${tf}-${sig.type}`;
      const last = user.lastAlerts[key] || 0;
      if (now - last < COOLDOWN_MS) continue;

      // Send and update
      const template = getTemplate(sig.type, asset.toUpperCase(), sig.data);
      await sendMessage(user.chatId, template);
      user.lastAlerts[key] = now;
      await saveUser(user);
    }
  }
}

// -------------------- Signal Message Templates --------------------
function getTemplate(type: string, asset: string, data: any): string {
  switch (type) {
    case "trend":
      return `📊 ${asset} Trend Update\n• Timeframe: ${data.timeframe.toUpperCase()}\n• Trend: ${data.trend.charAt(0).toUpperCase() + data.trend.slice(1)}\n• Price above EMA50 & EMA200\n\n⚠️ Educational only - not advice.`;
    case "rsi":
      const msg = data.status === "overbought" ? "Market may be overheated\n• Watch for pullback" : "Market may be oversold\n• Watch for bounce";
      return `⚠️ ${asset} RSI Alert\n• RSI: ${data.rsi}\n• ${msg}\n\n⚠️ Educational only - not advice.`;
    case "ema":
      const dir = data.cross === "bullish" ? "above" : "below";
      return `📈 ${asset} EMA Signal\n• EMA50 crossed ${dir} EMA200\n• Possible trend reversal\n\n⚠️ Educational only - not advice.`;
    case "sr":
      return `🧱 ${asset} Key Level\n• ${data.level.charAt(0).toUpperCase() + data.level.slice(1)}: $${data.value}\n• Price approaching ${data.level}\n\n⚠️ Educational only - not advice.`;
    case "combined":
      return `🚀 Smart Market Signal for ${asset}\n• Trend: ${data.trend.charAt(0).toUpperCase() + data.trend.slice(1)}\n• RSI: ${data.rsi} (healthy)\n• Price above EMA50\n• Near support zone\n\n⚠️ Educational only - not advice.`;
    default:
      return "";
  }
}

// -------------------- Webhook Handler --------------------
serve(async (req) => {
  try {
    const update = await req.json();
    const msg = update.message;
    if (!msg) return new Response("ok");
    const chatId = String(msg.chat.id);
    const text = msg.text?.trim() || "";
    const messageId = msg.message_id;
    if (msg.chat.type !== "private") {
      await sendMessage(chatId, "This bot works in private chats only.", messageId);
      return new Response("ok");
    }

    let user = await getUser(chatId);

    if (text === "/start") {
      user.assets = ["btc"];
      user.timeframes = ["1h"];
      user.indicators = ["rsi"];
      await saveUser(user);
      await sendMessage(
        chatId,
        "🧠 Welcome to Smart Signals Bot!\n\nThis is an educational tool for crypto market insights.\n\nFree features:\n- RSI alerts for BTC on 1H timeframe.\n\nUse /upgrade for premium (combined signals, more assets/timeframes).\n\nCommands:\n/addasset <asset> (e.g., btc)\n/addtf <tf> (e.g., 1h)\n/addindicator <ind> (e.g., rsi)\n/settings - View current settings\n\n⚠️ Not financial advice!"
      );
      return new Response("ok");
    }

    if (text === "/upgrade") { // For demo - in real, integrate payments
      user.premium = true;
      await saveUser(user);
      await sendMessage(chatId, "💎 Upgraded to Premium! Now access all features.");
      return new Response("ok");
    }

    if (text.startsWith("/addasset ")) {
      const ass = text.split(" ")[1].toLowerCase();
      if (!ASSETS.includes(ass)) {
        await sendMessage(chatId, `Invalid asset. Available: ${ASSETS.join(", ")}`);
        return new Response("ok");
      }
      if (!user.premium && ass !== "btc") {
        await sendMessage(chatId, "💎 Premium only for non-BTC assets.");
        return new Response("ok");
      }
      if (!user.assets.includes(ass)) user.assets.push(ass);
      await saveUser(user);
      await sendMessage(chatId, `✅ Added asset: ${ass.toUpperCase()}`);
      return new Response("ok");
    }

    if (text.startsWith("/addtf ")) {
      const tf = text.split(" ")[1].toLowerCase();
      if (!TIMEFRAMES.includes(tf)) {
        await sendMessage(chatId, `Invalid timeframe. Available: ${TIMEFRAMES.join(", ")}`);
        return new Response("ok");
      }
      if (!user.premium && tf !== "1h") {
        await sendMessage(chatId, "💎 Premium only for non-1H timeframes.");
        return new Response("ok");
      }
      if (!user.timeframes.includes(tf)) user.timeframes.push(tf);
      await saveUser(user);
      await sendMessage(chatId, `✅ Added timeframe: ${tf.toUpperCase()}`);
      return new Response("ok");
    }

    if (text.startsWith("/addindicator ")) {
      const ind = text.split(" ")[1].toLowerCase();
      if (!INDICATORS.includes(ind)) {
        await sendMessage(chatId, `Invalid indicator. Available: ${INDICATORS.join(", ")}`);
        return new Response("ok");
      }
      if (ind === "combined" && !user.premium) {
        await sendMessage(chatId, "💎 Combined signals are premium only.");
        return new Response("ok");
      }
      if (!user.indicators.includes(ind)) user.indicators.push(ind);
      await saveUser(user);
      await sendMessage(chatId, `✅ Added indicator: ${ind}`);
      return new Response("ok");
    }

    if (text === "/settings") {
      const prem = user.premium ? "💎 Premium" : "🆓 Free";
      const msg = `Your Settings:\n• Status: ${prem}\n• Assets: ${user.assets.join(", ") || "none"}\n• Timeframes: ${user.timeframes.join(", ") || "none"}\n• Indicators: ${user.indicators.join(", ") || "none"}`;
      await sendMessage(chatId, msg);
      return new Response("ok");
    }

    // Default response
    await sendMessage(chatId, "Unknown command. Use /start for help.");
  } catch (err) {
    console.error("Error handling update:", err);
  }
  return new Response("ok");
});
